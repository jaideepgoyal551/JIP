import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const batchOptions = ['Any batch', '2025', '2026', '2027', '2028', '2029', '2030', '2031', '2032']
const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID

function readSavedJobs() {
  try {
    const storedJobs = JSON.parse(localStorage.getItem('jip-saved-jobs') || '[]')
    return Array.isArray(storedJobs) ? storedJobs : []
  } catch {
    return []
  }
}

function Icon({ name, size = 18 }) {
  const paths = {
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.2 4.2" /></>,
    bookmark: <path d="M6 4.8A1.8 1.8 0 0 1 7.8 3h8.4A1.8 1.8 0 0 1 18 4.8V21l-6-4-6 4V4.8Z" />,
    chevron: <path d="m7 10 5 5 5-5" />,
    external: <><path d="M7 17 17 7M7 7h10v10" /></>,
    location: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    wallet: <><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M3 9h18M16 14h2" /><path d="M6 6V4.5A1.5 1.5 0 0 1 7.5 3H18" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.6 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.4-3" /></>,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
    briefcase: <><rect x="3" y="7" width="18" height="14" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-13 5h18m-11-1v2h4v-2" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    check: <path d="m5 12 4 4L19 6" />,
  }

  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  )
}

function GoogleSignInButton({ onSignIn, setError }) {
  const buttonRef = useRef(null)

  useEffect(() => {
    if (!googleClientId) return undefined
    let disposed = false
    let script = document.querySelector('script[data-google-identity]')

    const renderGoogleButton = () => {
      if (disposed || !window.google?.accounts?.id || !buttonRef.current) return
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async ({ credential }) => {
          setError('')
          try {
            await onSignIn(credential)
          } catch (signInError) {
            setError(signInError.message)
          }
        },
      })
      window.google.accounts.id.renderButton(buttonRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        shape: 'rectangular',
        text: 'signin_with',
        logo_alignment: 'left',
        width: Math.min(buttonRef.current.clientWidth || 320, 360),
      })
    }

    if (!script) {
      script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.dataset.googleIdentity = 'true'
      script.onload = renderGoogleButton
      script.onerror = () => setError('Google sign-in could not load. Check your connection and try again.')
      document.head.appendChild(script)
    } else {
      script.addEventListener('load', renderGoogleButton)
      renderGoogleButton()
    }

    return () => {
      disposed = true
      script?.removeEventListener('load', renderGoogleButton)
    }
  }, [onSignIn, setError])

  if (!googleClientId) {
    return <p className="signin-setup">Google sign-in needs a client ID. Set <code>VITE_GOOGLE_CLIENT_ID</code> in your local environment.</p>
  }

  return <div className="google-button" ref={buttonRef} aria-label="Sign in with Google" />
}

function SignInModal({ onClose, onSignIn }) {
  const [error, setError] = useState('')

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="signin-modal" role="dialog" aria-modal="true" aria-labelledby="signin-heading">
        <button className="modal-close icon-button" type="button" onClick={onClose} aria-label="Close sign in"><Icon name="close" size={19} /></button>
        <div className="signin-logo">j<span>.</span></div>
        <p className="eyebrow">JAIDEEP INTERNSHIP PLATFORM</p>
        <h2 id="signin-heading">Sign in to JIP</h2>
        <p className="signin-copy">Save internships and keep your search in one place.</p>
        <GoogleSignInButton onSignIn={onSignIn} setError={setError} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <p className="signin-terms">Your Google account is used only to sign you in.</p>
      </section>
    </div>
  )
}

function AdminModal({ onClose, onAddJob, isSaving }) {
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    const formData = new FormData(event.currentTarget)
    const job = Object.fromEntries(formData.entries())
    try {
      await onAddJob(job)
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-title">
        <div className="modal-heading">
          <div><span className="eyebrow">ADMIN</span><h2 id="admin-title">Post an internship</h2><p>Manually publish a verified employer opening.</p></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close form"><Icon name="close" /></button>
        </div>
        <form className="admin-form" onSubmit={handleSubmit}>
          <label>Role title<input name="title" placeholder="e.g. Product Design Intern" required /></label>
          <div className="form-row">
            <label>Company<input name="company" placeholder="Company name" required /></label>
            <label>Department<select name="department" defaultValue="Engineering"><option>Engineering</option><option>Design</option><option>Marketing</option><option>Data & Analytics</option><option>Business</option><option>Other</option></select></label>
          </div>
          <div className="form-row">
            <label>Location<input name="location" placeholder="e.g. Bengaluru, India" required /></label>
            <label>Region<select name="region" defaultValue="India"><option>India</option><option>Outside India</option></select></label>
          </div>
          <div className="form-row">
            <label>Stipend<input name="stipend" placeholder="e.g. ₹30,000 / month or Not disclosed" required /></label>
            <label>Eligible batches<input name="batch" placeholder="e.g. 2027, 2028 or Not specified" required /></label>
          </div>
          <label>Closing date<input name="deadline" placeholder="e.g. 30 Nov 2026 or Not specified" required /></label>
          <label>Employer application link<input name="url" type="url" placeholder="https://..." required /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={isSaving}>{isSaving ? 'Publishing…' : 'Publish opening'}</button></div>
        </form>
      </section>
    </div>
  )
}

function JobCard({ job, saved, onToggleSave }) {
  const date = job.postedAt ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(job.postedAt)) : 'Date not provided'

  return (
    <article className="job-card">
      <div className="job-card-heading">
        <div className="company-mark" aria-hidden="true">{job.company.slice(0, 1).toUpperCase()}</div>
        <div className="job-title-block"><div className="company-line">{job.company}<span className="source-badge">{job.source}</span></div><h3>{job.title}</h3></div>
        <button className={`icon-button save-button ${saved ? 'is-saved' : ''}`} type="button" onClick={() => onToggleSave(job.id)} aria-label={saved ? `Remove ${job.title} from saved jobs` : `Save ${job.title}`}>
          <Icon name="bookmark" size={17} />
        </button>
      </div>
      <div className="job-meta">
        <span><Icon name="location" size={15} />{job.location}</span>
        <span><Icon name="briefcase" size={15} />{job.department}</span>
        <span><Icon name="calendar" size={15} />{job.deadline ? `Closes ${job.deadline}` : `Updated ${date}`}</span>
      </div>
      <div className="job-foot">
        <div className="job-facts">
          <span><Icon name="wallet" size={15} /><strong>{job.stipend}</strong></span>
          <span className="eligibility"><Icon name="check" size={14} />{job.batchYears.length ? `Batch ${job.batchYears.join(', ')}` : 'Batch eligibility not specified'}</span>
        </div>
        <a className="apply-button" href={job.url} target="_blank" rel="noreferrer">View & apply <Icon name="external" size={15} /></a>
      </div>
    </article>
  )
}

function App() {
  const [jobs, setJobs] = useState([])
  const [companies, setCompanies] = useState([])
  const [failedCompanies, setFailedCompanies] = useState([])
  const [savedIds, setSavedIds] = useState(readSavedJobs)
  const [query, setQuery] = useState('')
  const [region, setRegion] = useState('All locations')
  const [batch, setBatch] = useState('Any batch')
  const [department, setDepartment] = useState('All roles')
  const [activePage, setActivePage] = useState('Internships')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [user, setUser] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [signInOpen, setSignInOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [isSavingJob, setIsSavingJob] = useState(false)

  async function fetchJobs(forceRefresh = false) {
    const response = await fetch(`/api/jobs${forceRefresh ? '?refresh=true' : ''}`)
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Could not load company internships.')
    return result
  }

  async function loadJobs(forceRefresh = false) {
    if (forceRefresh) {
      setRefreshing(true)
      setError('')
    }
    try {
      const result = await fetchJobs(forceRefresh)
      setJobs(result.jobs)
      setCompanies(result.companies)
      setFailedCompanies(result.failedCompanies)
      setUpdatedAt(result.updatedAt)
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      if (forceRefresh) setRefreshing(false)
      else setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    fetchJobs()
      .then((result) => {
        if (!active) return
        setJobs(result.jobs)
        setCompanies(result.companies)
        setFailedCompanies(result.failedCompanies)
        setUpdatedAt(result.updatedAt)
      })
      .catch((loadError) => {
        if (active) setError(loadError.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    fetch('/api/session')
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Could not check sign-in status.')
        if (!active) return
        setUser(result.user)
        setIsAdmin(result.isAdmin)
      })
      .catch((sessionError) => console.error('Unable to load sign-in status:', sessionError))
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('jip-saved-jobs', JSON.stringify(savedIds))
  }, [savedIds])

  const filteredJobs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return jobs.filter((job) => {
      const matchesSearch = !normalizedQuery || [job.title, job.company, job.department, job.location].some((value) => value.toLowerCase().includes(normalizedQuery))
      const matchesRegion = region === 'All locations' || job.region === region
      const matchesBatch = batch === 'Any batch' || job.batchYears.includes(batch)
      const matchesDepartment = department === 'All roles' || job.department.toLowerCase().includes(department.toLowerCase())
      const matchesSaved = activePage !== 'Saved jobs' || savedIds.includes(job.id)
      return matchesSearch && matchesRegion && matchesBatch && matchesDepartment && matchesSaved
    })
  }, [activePage, batch, department, jobs, query, region, savedIds])

  const signInWithGoogle = useCallback(async (credential) => {
    const response = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Google sign-in failed.')
    setUser(result.user)
    setIsAdmin(result.isAdmin)
    setSignInOpen(false)
  }, [])

  async function signOut() {
    const response = await fetch('/api/auth/logout', { method: 'POST' })
    if (!response.ok) throw new Error('Could not sign out. Please try again.')
    setUser(null)
    setIsAdmin(false)
  }

  function toggleSaved(id) {
    setSavedIds((current) => current.includes(id) ? current.filter((savedId) => savedId !== id) : [...current, id])
  }

  async function addJob(job) {
    setIsSavingJob(true)
    try {
      const response = await fetch('/api/admin/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not publish this job.')
      setJobs((current) => [result.job, ...current])
      setCompanies((current) => current.includes(result.job.company) ? current : [...current, result.job.company])
      setAdminOpen(false)
    } finally {
      setIsSavingJob(false)
    }
  }

  const visibleJobs = filteredJobs

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setActivePage('Internships') }}>
          <span className="brand-mark">j<span>.</span></span><span className="brand-name">jip<small>INTERNSHIP PORTAL</small></span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <button className={activePage === 'Internships' ? 'active' : ''} type="button" onClick={() => setActivePage('Internships')}>Internships</button>
          <button className={activePage === 'Saved jobs' ? 'active' : ''} type="button" onClick={() => setActivePage('Saved jobs')}>Saved jobs{savedIds.length > 0 && <span>{savedIds.length}</span>}</button>
        </nav>
        <div className="account-actions">
          {isAdmin && <button className="admin-button" type="button" onClick={() => setAdminOpen(true)}>Post a job</button>}
          {user ? <div className="signed-in"><span className="user-name">{user.name}</span><button className="signout-button" type="button" onClick={() => signOut().catch((signOutError) => setError(signOutError.message))}>Sign out</button></div> : <button className="signin-button" type="button" onClick={() => setSignInOpen(true)}>Sign in with Google</button>}
        </div>
      </header>

      <main className="page-content">
        <section className="page-heading">
          <div><div className="breadcrumb">Home <span>/</span> {activePage}</div><h1>{activePage === 'Saved jobs' ? 'Saved internships' : 'Internship openings'}</h1><p>Explore current internship opportunities at leading product companies.</p></div>
          {isAdmin && <button className="mobile-admin-button" type="button" onClick={() => setAdminOpen(true)}>+ Post a job</button>}
        </section>

        <section className="overview" aria-label="Live opening summary">
          <div className="overview-item"><span className="overview-number">{jobs.length}</span><span className="overview-label">live internships</span></div>
          <div className="overview-divider" />
          <div className="overview-item"><span className="overview-number">{companies.length}</span><span className="overview-label">product companies</span></div>
          <div className="overview-divider" />
          <div className="overview-item"><span className="overview-number">Live</span><span className="overview-label">official career pages</span></div>
          <div className="overview-updated">{updatedAt && <>Feed refreshed {new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(new Date(updatedAt))}</>}</div>
        </section>

        <section className="directory-section" aria-label="Internship directory">
          <div className="directory-title"><div><h2>{activePage === 'Saved jobs' ? 'Your saved openings' : 'Browse openings'}</h2><p>Openings are linked to the employer’s official careers page.</p></div><button className="refresh-button" type="button" disabled={refreshing} onClick={() => loadJobs(true)}><Icon name="refresh" size={15} />{refreshing ? 'Refreshing…' : 'Refresh'}</button></div>

          <div className="filters">
            <label className="search-input"><Icon name="search" size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by role, company, or keyword" aria-label="Search internships" />{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><Icon name="close" size={15} /></button>}</label>
            <label className="select-filter"><span>Role</span><select value={department} onChange={(event) => setDepartment(event.target.value)} aria-label="Filter by role"><option>All roles</option><option>Engineering</option><option>Design</option><option>Product</option><option>Marketing</option><option>Data</option><option>Business</option></select><Icon name="chevron" size={14} /></label>
            <label className="select-filter"><span>Graduation batch</span><select value={batch} onChange={(event) => setBatch(event.target.value)} aria-label="Filter by graduation batch">{batchOptions.map((year) => <option key={year}>{year}</option>)}</select><Icon name="chevron" size={14} /></label>
            <label className="select-filter"><span>Location</span><select value={region} onChange={(event) => setRegion(event.target.value)} aria-label="Filter by location"><option>All locations</option><option>India</option><option>Outside India</option></select><Icon name="chevron" size={14} /></label>
          </div>

          <div className="results-label"><span>{activePage === 'Saved jobs' ? 'SAVED OPENINGS' : 'CURRENT OPENINGS'}</span><span>{loading ? 'Loading…' : `${filteredJobs.length} ${filteredJobs.length === 1 ? 'opening' : 'openings'}`}</span></div>

          {error && <div className="status-message error-message" role="alert"><strong>Couldn’t load the latest openings.</strong><span>{error}</span><button type="button" onClick={() => loadJobs(true)}>Try again</button></div>}
          {failedCompanies.length > 0 && !error && <p className="partial-warning" role="status">Some career pages did not respond this time ({failedCompanies.length}); showing all available live results.</p>}
          {loading && <div className="loading-state"><span className="loading-spinner" />Loading live internships from company career pages…</div>}
          {!loading && !error && visibleJobs.length === 0 && <div className="empty-state"><div className="empty-icon"><Icon name={activePage === 'Saved jobs' ? 'bookmark' : 'briefcase'} size={22} /></div><h3>{activePage === 'Saved jobs' ? 'No saved openings yet' : 'No matching internships'}</h3><p>{activePage === 'Saved jobs' ? 'Select the bookmark on an opening to save it here.' : 'Try changing your search or filters, or check back later for new roles.'}</p>{activePage === 'Saved jobs' && <button type="button" className="text-link" onClick={() => setActivePage('Internships')}>Browse all internships</button>}</div>}
          <div className="job-list">
            {!loading && !error && visibleJobs.map((job) => <JobCard key={job.id} job={job} saved={savedIds.includes(job.id)} onToggleSave={toggleSaved} />)}
          </div>
          <div className="data-note"><Icon name="globe" size={14} /><span>Listings are fetched from official company career pages. Stipend, batch eligibility, and closing dates are shown only when the employer publishes them.</span></div>
        </section>
        <footer className="page-footer"><span>JIP <span>·</span> Jaideep Internship Platform</span><span>Each opening links to the employer’s application page.</span></footer>
      </main>

      {signInOpen && <SignInModal onClose={() => setSignInOpen(false)} onSignIn={signInWithGoogle} />}
      {adminOpen && <AdminModal onClose={() => setAdminOpen(false)} onAddJob={addJob} isSaving={isSavingJob} />}
    </div>
  )
}

export default App
