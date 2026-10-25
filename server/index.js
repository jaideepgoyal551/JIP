import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApiHandler } from './api.js'

const projectDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const distributionDirectory = path.join(projectDirectory, 'dist')
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}
const apiHandler = createApiHandler({ dataDirectory: path.join(projectDirectory, 'data') })

async function serveStatic(request, response) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' })
    response.end()
    return
  }

  let pathname
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  } catch {
    response.writeHead(400)
    response.end()
    return
  }

  const requestedPath = path.resolve(distributionDirectory, `.${pathname}`)
  const insideDistribution = requestedPath.startsWith(`${distributionDirectory}${path.sep}`)
  const filePath = insideDistribution && (await stat(requestedPath).catch(() => null))?.isFile()
    ? requestedPath
    : path.join(distributionDirectory, 'index.html')

  try {
    const file = await readFile(filePath)
    response.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream' })
    response.end(request.method === 'HEAD' ? undefined : file)
  } catch (error) {
    console.error('Unable to serve the production app:', error)
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('The application build is missing. Run npm run build before starting the production server.')
  }
}

const port = Number(process.env.PORT || 4173)
createServer((request, response) => {
  apiHandler(request, response, () => serveStatic(request, response))
}).listen(port, '0.0.0.0', () => {
  console.log(`JIP is listening on port ${port}`)
})
