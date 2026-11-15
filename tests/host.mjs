import http from 'node:http'
import { apply } from '../src/index.js'

export function startFixtureHost(cwd, port = 0) {
  const effects = []
  const routes = []
  const ctx = {
    sessions: { get: id => id === 'session-1' ? { header: { cwd } } : undefined },
    webServer: { register: route => { routes.push(route); return () => {} } },
    effect: callback => { effects.push(callback); if (typeof callback === 'function') callback(); return callback },
  }
  apply(ctx)
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname
    const route = routes.find(item => pathname.startsWith(item.path))
    if (route) route.handler(req, res)
    else { res.writeHead(404); res.end() }
  })
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({
    server,
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(done => server.close(done)),
  })))
}
