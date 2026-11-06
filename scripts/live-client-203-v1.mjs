import {chromium} from 'playwright';import path from 'node:path';
/** QA process only: original verified company TLS over HTTP/1.1. Server protocol
 * and networking stay unchanged; the separate retained HTTP/2 attempt stalled. */
export async function launch(){return chromium.launch({headless:true,executablePath:path.resolve('.data/browsers/chromium-1248/chrome-win64/chrome.exe'),proxy:{server:process.env.WORKMATE_QA_PROXY,bypass:'127.0.0.1,localhost'},args:['--disable-quic','--disable-http2']});}
