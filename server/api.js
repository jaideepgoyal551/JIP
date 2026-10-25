import { createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { OAuth2Client } from 'google-auth-library'

const careerBoards = [
  { company: 'Airbnb', board: 'airbnb' },
  { company: 'Asana', board: 'asana' },
  { company: 'Cloudflare', board: 'cloudflare' },
  { company: 'Coinbase', board: 'coinbase' },
  { company: 'Discord', board: 'discord' },
  { company: 'Dropbox', board: 'dropbox' },
  { company: 'Duolingo', board: 'duolingo' },
  { company: 'Figma', board: 'figma' },
  { company: 'Gusto', board: 'gusto' },
  { company: 'Groww', board: 'groww' },
  { company: 'InMobi', board: 'inmobi' },
  { company: 'Lyft', board: 'lyft' },
  { company: 'MongoDB', board: 'mongodb' },
  { company: 'Pinterest', board: 'pinterest' },
  { company: 'Reddit', board: 'reddit' },
  { company: 'Stripe', board: 'stripe' },
]

const cacheDurationMs = 10 * 60 * 1000
const sessionDurationSeconds = 60 * 60 * 24 * 7
const oauthClient = new OAuth2Client()
let jobsCache

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers })
  response.end(JSON.stringify(value))
}

async function readBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 16_384) throw new Error('Request body is too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function escapeHtml(value) {
  return value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim()
}

function getText(value) {
  return typeof value === 'string' ? value : ''
}

function getDescription(job) {
  return escapeHtml(getText(job.content))
}

function extractStipend(description) {
  const match = description.match(/(?:₹|Rs\.?\s?|INR\s?|\$|USD\s?)\s?\d[\d,.]*(?:\s?(?:-|to)\s*(?:₹|Rs\.?\s?|INR\s?|\$|USD\s?)?\d[\d,.]*)?\s*(?:per|\/)\s*(?:year|annum|month|hour|week|day|hr|mo|yr|monthly|hourly|weekly|annually)\b/i)
  return match?.[0]?.trim() || 'Not disclosed'
}

function extractBatches(title, description) {
  const years = new Set()
  const text = `${title} ${description}`
  const explicitEligibility = /\b(?:class\s+of|batch(?:\s+of)?|graduating(?:\s+in)?|graduation(?:\s+year)?[:\s]+|expected\s+graduation(?:\s+year)?[:\s]+|expected\s+to\s+graduate(?:\s+in)?)\s*(20(?:2[5-9]|3[0-2]))\b/gi
  for (const match of text.matchAll(explicitEligibility)) years.add(match[1])
  return [...years].sort()
}

function normalizeJob(job, company) {
  const title = getText(job.title).trim()
  const description = getDescription(job)
  const location = getText(job.location?.name) || 'Location not specified'
  const date = job.updated_at || job.created_at || null
  const parsedDate = date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null
  const salaryText = extractStipend(`${description} ${JSON.stringify(job.metadata || [])}`)

  return {
    id: `${company.toLowerCase()}-${job.id}`,
    company,
    title,
    department: getText(job.departments?.[0]?.name) || 'Internship',
    location,
    region: /\bindia\b|\bbengaluru\b|\bbangalore\b|\bmumbai\b|\bhyderabad\b|\bdelhi\b|\bpune\b|\bchennai\b|\bnoida\b|\bgurugram\b/i.test(location)
      ? 'India'
      : 'Outside India',
    stipend: salaryText,
    postedAt: parsedDate,
    batchYears: extractBatches(title, description),
    url: getText(job.absolute_url),
    source: 'Greenhouse',
  }
}

async function fetchCompanyJobs({ company, board }) {
  const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`, {
    signal: AbortSignal.timeout(12_000),
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`${company} careers feed returned HTTP ${response.status}`)

  const data = await response.json()
  if (!Array.isArray(data.jobs)) throw new Error(`${company} careers feed returned an unexpected response`)
  const internships = data.jobs
    .filter((job) => /\b(intern|internship|co[\s-]?op)\b/i.test(getText(job.title)))
    .map((job) => normalizeJob(job, company))
    .filter((job) => job.url)
  return { company, internships }
}

async function readManualJobs(dataDirectory) {
  try {
    const contents = await readFile(path.join(dataDirectory, 'manual-jobs.json'), 'utf8')
    const jobs = JSON.parse(contents)
    if (!Array.isArray(jobs)) throw new Error('Manual jobs file must contain an array')
    return jobs
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

async function loadJobs(dataDirectory, forceRefresh = false) {
  if (!forceRefresh && jobsCache && Date.now() - jobsCache.loadedAt < cacheDurationMs) {
    const manualJobs = await readManualJobs(dataDirectory)
    return { ...jobsCache.value, jobs: [...manualJobs, ...jobsCache.value.jobs] }
  }

  const results = await Promise.allSettled(careerBoards.map(fetchCompanyJobs))
  const companies = []
  const failedCompanies = []
  const jobs = []
  for (const result of results) {
    if (result.status === 'fulfilled') {
      companies.push(result.value.company)
      jobs.push(...result.value.internships)
    } else {
      failedCompanies.push(result.reason.message)
    }
  }
  if (companies.length === 0) throw new Error('All company careers feeds are currently unavailable')

  jobs.sort((a, b) => (Date.parse(b.postedAt || '') || 0) - (Date.parse(a.postedAt || '') || 0))
  const value = { jobs, companies, failedCompanies, updatedAt: new Date().toISOString() }
  jobsCache = { loadedAt: Date.now(), value }
  const manualJobs = await readManualJobs(dataDirectory)
  return { ...value, jobs: [...manualJobs, ...value.jobs] }
}

function signSession(payload, secret) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(encodedPayload).digest('base64url')
  return `${encodedPayload}.${signature}`
}

function readSession(request, secret) {
  const cookie = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('jip_session='))
  if (!cookie) return null
  const [encodedPayload, signature] = cookie.slice('jip_session='.length).split('.')
  if (!encodedPayload || !signature) return null
  const expected = createHmac('sha256', secret).update(encodedPayload).digest()
  let received
  try {
    received = Buffer.from(signature, 'base64url')
  } catch {
    return null
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
    if (!payload.exp || payload.exp < Date.now() / 1000) return null
    return payload
  } catch {
    return null
  }
}

function sessionCookie(value, maxAge, secure) {
  return `jip_session=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

function isAdmin(session, adminEmails) {
  return Boolean(session?.email && adminEmails.has(session.email.toLowerCase()))
}

export function createApiHandler({ clientId = process.env.GOOGLE_CLIENT_ID, sessionSecret = process.env.SESSION_SECRET, adminEmails = process.env.ADMIN_EMAILS, dataDirectory = path.resolve('data') } = {}) {
  const allowedAdmins = new Set((adminEmails || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean))
  const secureCookie = process.env.NODE_ENV === 'production'

  return async function apiHandler(request, response, next) {
    const requestUrl = new URL(request.url, 'http://localhost')
    if (!requestUrl.pathname.startsWith('/api/')) {
      if (next) return next()
      response.writeHead(404)
      response.end()
      return
    }

    try {
      if (requestUrl.pathname === '/api/health' && request.method === 'GET') {
        return sendJson(response, 200, { status: 'ok' })
      }

      if (requestUrl.pathname === '/api/jobs' && request.method === 'GET') {
        try {
          return sendJson(response, 200, await loadJobs(dataDirectory, requestUrl.searchParams.get('refresh') === 'true'))
        } catch (error) {
          console.error('Unable to load company job feeds:', error)
          return sendJson(response, 502, { error: 'Live company listings are temporarily unavailable. Please try again shortly.' })
        }
      }

      if (requestUrl.pathname === '/api/session' && request.method === 'GET') {
        if (!sessionSecret) return sendJson(response, 503, { error: 'Google sign-in is not configured on the server.' })
        const session = readSession(request, sessionSecret)
        return sendJson(response, 200, {
          user: session ? { name: session.name, email: session.email, picture: session.picture } : null,
          isAdmin: isAdmin(session, allowedAdmins),
        })
      }

      if (requestUrl.pathname === '/api/auth/google' && request.method === 'POST') {
        if (!clientId || !sessionSecret) return sendJson(response, 503, { error: 'Google sign-in is not configured on the server.' })
        const body = await readBody(request)
        if (typeof body.credential !== 'string') return sendJson(response, 400, { error: 'A Google credential is required.' })

        let payload
        try {
          const ticket = await oauthClient.verifyIdToken({ idToken: body.credential, audience: clientId })
          payload = ticket.getPayload()
        } catch {
          return sendJson(response, 401, { error: 'Google could not verify this sign-in. Please try again.' })
        }
        if (!payload?.email || !payload.email_verified || !payload.sub) {
          return sendJson(response, 401, { error: 'Use a verified Google account to sign in.' })
        }

        const session = {
          sub: payload.sub,
          email: payload.email.toLowerCase(),
          name: payload.name || payload.email,
          picture: payload.picture || '',
          exp: Math.floor(Date.now() / 1000) + sessionDurationSeconds,
        }
        return sendJson(response, 200, { user: { name: session.name, email: session.email, picture: session.picture }, isAdmin: isAdmin(session, allowedAdmins) }, {
          'Set-Cookie': sessionCookie(signSession(session, sessionSecret), sessionDurationSeconds, secureCookie),
        })
      }

      if (requestUrl.pathname === '/api/auth/logout' && request.method === 'POST') {
        return sendJson(response, 200, { user: null }, { 'Set-Cookie': sessionCookie('', 0, secureCookie) })
      }

      if (requestUrl.pathname === '/api/admin/jobs' && request.method === 'POST') {
        if (!sessionSecret) return sendJson(response, 503, { error: 'Sign-in is not configured on the server.' })
        const session = readSession(request, sessionSecret)
        if (!session) return sendJson(response, 401, { error: 'Sign in with your admin Google account to add a job.' })
        if (!isAdmin(session, allowedAdmins)) return sendJson(response, 403, { error: 'This Google account is not authorized to add jobs.' })

        const body = await readBody(request)
        const requiredFields = ['company', 'title', 'department', 'location', 'stipend', 'deadline', 'batch']
        if (requiredFields.some((field) => typeof body[field] !== 'string' || !body[field].trim())) {
          return sendJson(response, 400, { error: 'Complete all required job details before publishing.' })
        }
        let applicationUrl
        try {
          applicationUrl = new URL(body.url)
        } catch {
          return sendJson(response, 400, { error: 'Enter a valid employer application URL.' })
        }
        if (!['https:', 'http:'].includes(applicationUrl.protocol)) return sendJson(response, 400, { error: 'Enter an HTTP or HTTPS application URL.' })

        await mkdir(dataDirectory, { recursive: true })
        const manualJobs = await readManualJobs(dataDirectory)
        const job = {
          id: `admin-${Date.now()}`,
          company: body.company.trim(),
          title: body.title.trim(),
          department: body.department.trim(),
          location: body.location.trim(),
          region: body.region === 'India' ? 'India' : 'Outside India',
          stipend: body.stipend.trim(),
          deadline: body.deadline.trim(),
          postedAt: new Date().toISOString(),
          batchYears: body.batch.split(',').map((year) => year.trim()).filter(Boolean),
          url: applicationUrl.toString(),
          source: `Added by ${session.name}`,
        }
        await writeFile(path.join(dataDirectory, 'manual-jobs.json'), JSON.stringify([job, ...manualJobs], null, 2))
        return sendJson(response, 201, { job })
      }

      if (requestUrl.pathname.startsWith('/api/')) return sendJson(response, 404, { error: 'API endpoint not found.' })
      return sendJson(response, 404, { error: 'API endpoint not found.' })
    } catch (error) {
      console.error('API request failed:', error)
      if (!response.headersSent) return sendJson(response, 500, { error: 'The request could not be completed. Please try again.' })
      response.end()
    }
  }
}

export { careerBoards }
