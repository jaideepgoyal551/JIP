import { createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { list, put } from '@vercel/blob'
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

const featuredJobs = [
  {
    id: 'featured-cisco-2021284',
    company: 'Cisco',
    title: 'Software Engineer – Network/Embedded/Application Development (Summer Internship)',
    department: 'Engineering',
    location: 'Bangalore, India',
    region: 'India',
    workMode: 'Hybrid',
    stipend: 'Not disclosed',
    postedAt: null,
    deadline: '',
    batchYears: ['2028'],
    url: 'https://careers.cisco.com/global/en/job/CISCISGLOBAL2021284EXTERNALENGLOBAL/Software-Engineer-Network-Embedded-Application-Development-Summer-Internship-India-EG-Requisition',
    source: 'Cisco Careers',
    featuredOrder: 1,
  },
  {
    id: 'featured-enterpret-7847134003',
    company: 'Enterpret',
    title: '[Backend, Onsite] Software Engineering Intern',
    department: 'Engineering',
    location: 'Bengaluru, India',
    region: 'India',
    workMode: 'On-site',
    stipend: 'Paid — details on listing',
    postedAt: null,
    deadline: '',
    batchYears: [],
    url: 'https://job-boards.greenhouse.io/enterpret/jobs/7847134003',
    source: 'Enterpret',
    featuredOrder: 2,
  },
]

const cacheDurationMs = 10 * 60 * 1000
const sessionDurationSeconds = 60 * 60 * 24 * 7
const manualJobsBlobPath = 'jip/manual-jobs.json'
const oauthClient = new OAuth2Client()
let jobsCache

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers })
  response.end(JSON.stringify(value))
}

async function readBody(request) {
  if (request.body !== undefined) {
    if (typeof request.body === 'string') return JSON.parse(request.body)
    if (request.body && typeof request.body === 'object') return request.body
  }

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
    workMode: /remote/i.test(location) ? 'Remote' : /hybrid/i.test(location) ? 'Hybrid' : 'On-site',
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

function formatUnstopStipend(jobDetail) {
  const minimum = Number(jobDetail.min_salary)
  const maximum = Number(jobDetail.max_salary)
  const period = getText(jobDetail.pay_in).replace(/ly$/, '')
  const periodLabel = period ? ` / ${period}` : ''
  const formatAmount = (amount) => `₹${new Intl.NumberFormat('en-IN').format(amount)}`
  if (Number.isFinite(minimum) && Number.isFinite(maximum) && minimum > 0 && maximum > 0) {
    return `${formatAmount(minimum)}${minimum === maximum ? '' : `–${formatAmount(maximum)}`}${periodLabel}`
  }
  if (Number.isFinite(minimum) && minimum > 0) return `${formatAmount(minimum)}${periodLabel}`
  if (Number.isFinite(maximum) && maximum > 0) return `${formatAmount(maximum)}${periodLabel}`
  return 'Paid — details on listing'
}

function normalizeUnstopJob(job) {
  const title = getText(job.title).trim()
  const company = getText(job.organisation?.name).trim()
  const jobDetail = job.jobDetail || {}
  if (!job.id || !title || !company || jobDetail.paid_unpaid !== 'paid' || jobDetail.not_disclosed === true) return null

  const locations = Array.isArray(job.locations)
    ? job.locations.map((location) => [location.city, location.state].filter(Boolean).join(', ')).filter(Boolean)
    : []
  const location = jobDetail.type === 'wfh'
    ? 'Remote (India)'
    : locations.length
      ? locations.join(' · ')
      : 'India'
  const updatedAt = getText(job.updated_at)
  const parsedDate = updatedAt && !Number.isNaN(Date.parse(updatedAt)) ? new Date(updatedAt).toISOString() : null
  const endDate = getText(job.end_date)
  const parsedDeadline = endDate && !Number.isNaN(Date.parse(endDate))
    ? new Date(endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
    : ''
  const publicUrl = getText(job.public_url)
  let applicationUrl
  try {
    applicationUrl = new URL(publicUrl, 'https://unstop.com')
  } catch {
    return null
  }
  if (applicationUrl.hostname !== 'unstop.com') return null

  return {
    id: `unstop-${job.id}`,
    company,
    title,
    department: getText(job.workfunction?.[0]?.name) || 'Internship',
    location,
    region: 'India',
    workMode: jobDetail.type === 'wfh' ? 'Remote' : jobDetail.type === 'hybrid' ? 'Hybrid' : 'On-site',
    stipend: formatUnstopStipend(jobDetail),
    postedAt: parsedDate,
    deadline: parsedDeadline,
    batchYears: extractBatches(title, escapeHtml(getText(job.details))),
    url: applicationUrl.toString(),
    logo: getText(job.logoUrl2) || getText(job.organisation?.logoUrl2) || getText(job.organisation?.logoUrl),
    source: 'Unstop',
  }
}

async function fetchUnstopInternships() {
  const pages = await Promise.allSettled([1, 2, 3, 4].map(async (page) => {
    const url = `https://unstop.com/api/public/opportunity/search-result?opportunity=internships&oppstatus=open&per_page=50&page=${page}`
    const response = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 JIP Internship Portal' },
    })
    if (!response.ok) throw new Error(`Unstop internships feed returned HTTP ${response.status}`)
    const result = await response.json()
    if (!Array.isArray(result.data?.data)) throw new Error('Unstop internships feed returned an unexpected response')
    return result.data.data
  }))
  const successfulPages = pages.filter((page) => page.status === 'fulfilled')
  if (successfulPages.length === 0) {
    throw new Error(pages.find((page) => page.status === 'rejected')?.reason?.message || 'Unstop internships feed is unavailable')
  }
  const internships = successfulPages
    .flatMap((page) => page.value)
    .map(normalizeUnstopJob)
    .filter(Boolean)
  return { company: 'Unstop', internships }
}

async function readManualJobs(dataDirectory) {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN
  if (blobToken) {
    const { blobs } = await list({ prefix: manualJobsBlobPath, token: blobToken })
    const manualJobsBlob = blobs.find((blob) => blob.pathname === manualJobsBlobPath)
    if (!manualJobsBlob) return []
    const response = await fetch(manualJobsBlob.url, { cache: 'no-store' })
    if (!response.ok) throw new Error(`Unable to read manual jobs from Vercel Blob (HTTP ${response.status})`)
    const jobs = await response.json()
    if (!Array.isArray(jobs)) throw new Error('Manual jobs blob must contain an array')
    return jobs
  }

  if (process.env.VERCEL) return []

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

async function writeManualJobs(dataDirectory, jobs) {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN
  if (blobToken) {
    await put(manualJobsBlobPath, JSON.stringify(jobs), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json; charset=utf-8',
      cacheControlMaxAge: 60,
      token: blobToken,
    })
    return
  }

  if (process.env.VERCEL) {
    throw new Error('Add a BLOB_READ_WRITE_TOKEN environment variable to enable persistent job posting on Vercel.')
  }

  await mkdir(dataDirectory, { recursive: true })
  await writeFile(path.join(dataDirectory, 'manual-jobs.json'), JSON.stringify(jobs, null, 2))
}

async function loadJobs(dataDirectory, forceRefresh = false) {
  if (!forceRefresh && jobsCache && Date.now() - jobsCache.loadedAt < cacheDurationMs) {
    const manualJobs = await readManualJobs(dataDirectory)
    return { ...jobsCache.value, jobs: [...manualJobs, ...jobsCache.value.jobs] }
  }

  const results = await Promise.allSettled([
    ...careerBoards.map(fetchCompanyJobs),
    fetchUnstopInternships(),
  ])
  const companies = []
  const failedCompanies = []
  const jobs = [...featuredJobs]
  for (const result of results) {
    if (result.status === 'fulfilled') {
      companies.push(result.value.company)
      jobs.push(...result.value.internships)
    } else {
      failedCompanies.push(result.reason.message)
    }
  }
  if (companies.length === 0) throw new Error('All company careers feeds are currently unavailable')

  jobs.sort((a, b) => (a.featuredOrder || Number.POSITIVE_INFINITY) - (b.featuredOrder || Number.POSITIVE_INFINITY)
    || (Date.parse(b.postedAt || '') || 0) - (Date.parse(a.postedAt || '') || 0))
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
          const forceRefresh = requestUrl.searchParams.get('refresh') === 'true'
          return sendJson(response, 200, await loadJobs(dataDirectory, forceRefresh), {
            'Cache-Control': forceRefresh ? 'no-store' : 'public, s-maxage=60, stale-while-revalidate=300',
          })
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

        const manualJobs = await readManualJobs(dataDirectory)
        const job = {
          id: `admin-${Date.now()}`,
          company: body.company.trim(),
          title: body.title.trim(),
          department: body.department.trim(),
          location: body.location.trim(),
          workMode: ['On-site', 'Hybrid', 'Remote'].includes(body.workMode) ? body.workMode : 'On-site',
          region: body.region === 'India' ? 'India' : 'Outside India',
          stipend: body.stipend.trim(),
          deadline: body.deadline.trim(),
          postedAt: new Date().toISOString(),
          batchYears: body.batch.split(',').map((year) => year.trim()).filter(Boolean),
          url: applicationUrl.toString(),
          source: `Added by ${session.name}`,
        }
        try {
          await writeManualJobs(dataDirectory, [job, ...manualJobs])
        } catch (error) {
          console.error('Unable to persist admin job:', error)
          return sendJson(response, 503, {
            error: process.env.VERCEL && !process.env.BLOB_READ_WRITE_TOKEN
              ? 'Persistent job storage is not configured. Add a Vercel Blob store and set BLOB_READ_WRITE_TOKEN.'
              : 'Could not save the new job. Please check the server storage configuration and try again.',
          })
        }
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
