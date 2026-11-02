"""Owned HTTPS CONNECT path; canonical TLS, origins and replies stay unchanged."""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import base64
import hashlib
import json
import paramiko
import select
import threading
import sys
import time

metrics = []
metric_lock = threading.Lock()

delivery = Path(__file__).resolve().parents[1]
secret = json.loads((delivery / '.data/deployment-189/server-access.private.json').read_text(encoding='utf8'))
transport = paramiko.Transport((secret['host'], 22))
transport.start_client(timeout=15)
fingerprint = base64.b64encode(hashlib.sha256(transport.get_remote_server_key().asbytes()).digest()).decode().rstrip('=')
assert fingerprint == 'kE5X8/plm2Sr6rI1XOnE82hIcddnpP/i9gvybtg2GNE'
transport.auth_password(secret['username'], secret['password'])
del secret
transport.set_keepalive(25)
allowed = {'agent.copypaste.hk', 'agent-dashboard.copypaste.hk', 'ai-api.copypaste.hk'}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_CONNECT(self):
        hostname, sep, port = self.path.rpartition(':')
        if not sep or hostname not in allowed or port != '443':
            self.send_error(403)
            return
        channel = None
        observed = {'host': hostname, 'started_at': time.time(), 'sent_bytes': 0, 'received_bytes': 0}
        try:
            # No HTTP replay. Only a TCP connection that has accepted no TLS or
            # application bytes can fall back before the CONNECT is acknowledged.
            for address in ['172.67.180.165', '104.21.43.151']:
                try:
                    channel = transport.open_channel('direct-tcpip', (address, 443), self.client_address, timeout=10)
                    observed['address'] = address
                    break
                except (OSError, EOFError, paramiko.SSHException):
                    continue
            if channel is None:
                self.send_error(502)
                return
            self.send_response(200, 'Connection established')
            self.end_headers()
            while True:
                ready, _, _ = select.select([self.connection, channel], [], [], 120)
                if not ready:
                    break
                if self.connection in ready:
                    data = self.connection.recv(65536)
                    if not data:
                        break
                    observed['sent_bytes'] += len(data)
                    channel.sendall(data)
                if channel in ready:
                    data = channel.recv(65536)
                    if not data:
                        break
                    observed['received_bytes'] += len(data)
                    self.connection.sendall(data)
        except (OSError, EOFError, paramiko.SSHException):
            pass
        finally:
            observed['elapsed_ms'] = round((time.time() - observed.pop('started_at')) * 1000)
            with metric_lock:
                metrics.append(observed)
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

server = ThreadingHTTPServer(('127.0.0.1', 11237), Handler)
server.daemon_threads = True
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
print(json.dumps({'status':'ready','proxy':'http://127.0.0.1:11237','tls_verification':'client end-to-end','allowed_hosts':sorted(allowed)}), flush=True)
try:
    for line in sys.stdin:
        action = json.loads(line).get('action')
        if action == 'status':
            with metric_lock:
                print(json.dumps({'connections': metrics}), flush=True)
        if action == 'close':
            break
finally:
    server.shutdown()
    server.server_close()
    transport.close()
    print(json.dumps({'status':'closed'}), flush=True)
