"""Owned loopback CONNECT transport for real HTTPS QA through the application host.

TLS remains end-to-end in Chromium. No response, cookie, origin or certificate
is rewritten. Only the three product hostnames on port443 may be reached.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import getpass, json, paramiko, select, threading

ROOT = Path(__file__).resolve().parents[3]
ALLOWED = {'agent.copypaste.hk', 'agent-dashboard.copypaste.hk', 'ai-api.copypaste.hk'}
secret = getpass.getpass('SSH password (memory only): ')
ssh = paramiko.SSHClient()
ssh.load_host_keys(str(ROOT / 'dev/copypaste-delivery/.data/deployment-176/known_hosts'))
ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
ssh.connect('192.168.31.20', username='carzygod', password=secret,
            look_for_keys=False, allow_agent=False, timeout=15)
del secret
ssh.get_transport().set_keepalive(25)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_CONNECT(self):
        host, sep, raw_port = self.path.rpartition(':')
        if not sep or host not in ALLOWED or raw_port != '443':
            self.send_error(403)
            return
        channel = None
        try:
            channel = ssh.get_transport().open_channel('direct-tcpip', (host, 443), self.client_address, timeout=15)
            self.send_response(200, 'Connection established')
            self.end_headers()
            while True:
                ready, _, _ = select.select([self.connection, channel], [], [], 30)
                if not ready:
                    break
                if self.connection in ready:
                    data = self.connection.recv(65536)
                    if not data:
                        break
                    channel.sendall(data)
                if channel in ready:
                    data = channel.recv(65536)
                    if not data:
                        break
                    self.connection.sendall(data)
        except (OSError, EOFError, paramiko.SSHException):
            pass
        finally:
            if channel:
                channel.close()
            self.close_connection = True

    def do_GET(self):
        if self.path != '/health':
            self.send_error(405)
            return
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"status":"ready","tls_rewritten":false}\n')

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
server.daemon_threads = True
worker = threading.Thread(target=server.serve_forever, daemon=True)
worker.start()
print(json.dumps({'status': 'ready', 'proxy': 'http://127.0.0.1:' + str(server.server_port),
                  'allowed_hosts': sorted(ALLOWED), 'tls_verification': 'browser end-to-end'}), flush=True)
try:
    for line in __import__('sys').stdin:
        if json.loads(line).get('action') == 'close':
            break
finally:
    server.shutdown()
    server.server_close()
    ssh.close()
    print(json.dumps({'status': 'closed'}), flush=True)
