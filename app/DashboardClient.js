'use client'
import React, { useState, useMemo, useEffect } from 'react'
import useSWR from 'swr'
import ExcelJS from 'exceljs'
import { useRouter } from 'next/navigation'

const fetcher = url => fetch(url).then(res => res.json())

// Proxy Odoo images through our API route — Odoo blocks direct <img> sub-resource loads
// but our server-side proxy fetches successfully (confirmed: 200, image/png)
const proxyImg = (url) => url ? `/api/img-proxy?url=${encodeURIComponent(url)}` : null

const PLACEHOLDER_IMG = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
const NOTE_ICONS = { watch:'👁', price_down:'↓', price_up:'↑', special:'⭐' }
const NOTE_LABELS = { watch:'Watch', price_down:'Price Down', price_up:'Price Up', special:'Special Price' }
const RISE_TIER_LABEL = {tier1:'+5–10pt', tier2:'+10–15pt', tier3:'+15pt+'}

function escHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) }

export default function DashboardClient() {
  const router = useRouter()

  // Date range state must come first — useMemo below reads these
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [pendingFrom, setPendingFrom] = useState('')
  const [pendingTo, setPendingTo] = useState('')

  // Build the SWR key so changing the date range triggers a new fetch
  const swrKey = useMemo(() => {
    const params = new URLSearchParams()
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo)   params.set('to', dateTo)
    const qs = params.toString()
    const key = qs ? `/api/dashboard-data?${qs}` : '/api/dashboard-data'
    console.log('[Dashboard] SWR key:', key)
    return key
  }, [dateFrom, dateTo])

  const { data: serverData, error, isLoading, isValidating } = useSWR(swrKey, fetcher, {
    refreshInterval: 10 * 60 * 1000 // 10 minutes
  })

  // State
  const [periodId, setPeriodId] = useState('whole')
  const [compare, setCompare] = useState(false)
  const [compareId, setCompareId] = useState(null)
  const [newOnly, setNewOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [health, setHealth] = useState('all')
  const [notesFilter, setNotesFilter] = useState('all')
  const [minRev, setMinRev] = useState(0)
  const [sortBy, setSortBy] = useState('rev')
  const [sortDir, setSortDir] = useState('desc')
  const [openCats, setOpenCats] = useState(new Set())
  const [deletedCats, setDeletedCats] = useState(new Set())
  const [deletedSkus, setDeletedSkus] = useState(new Set())
  const [groupSort, setGroupSort] = useState(new Map())
  const [notes, setNotes] = useState(new Map())
  const [hoverTip, setHoverTip] = useState({ visible: false, x: 0, y: 0, img: '', name: '' })
  
  // Helpers
  const RAW_PERIODS = serverData?.periods || []
  
  const getPeriod = id => RAW_PERIODS.find(p => p.id === id)
  const otherPeriod = id => RAW_PERIODS.find(p => p.id !== id)
  
  const period = getPeriod(periodId) || RAW_PERIODS[0]
  const cmpPeriod = compare && compareId ? getPeriod(compareId) : null
  
  const visRows = (p) => {
    if (!p) return []
    return p.rows.filter(r => {
      if (newOnly && !r.isNew) return false
      if (deletedSkus.has(r.n)) return false
      if (deletedCats.has(r.c)) return false
      return true
    })
  }
  
  const healthClass = (r) => {
    if (r.stock === 0 && r.sold === 0) return 'never_arrived'
    if (r.stock === 0 && r.sold > 0) return 'sold_out'
    if (r.stock > 0 && r.sold === 0) return 'stagnant'
    if (r.cov < 15) return 'critical'
    if (r.cov < 30) return 'low'
    return 'healthy'
  }
  
  const healthLabel = (cls) => ({never_arrived:'Never Arrived', sold_out:'Sold Out', stagnant:'No Movement', critical:'Critical', low:'Low', healthy:'Healthy'}[cls] || cls)
  const isNeverArrived = r => r.stock === 0 && r.sold === 0
  const isSoldOut = r => r.stock === 0 && r.sold > 0
  const isStagnant = r => r.stock > 0 && r.sold === 0
  const covHealthFromDays = (cov) => cov < 15 ? 'critical' : cov < 30 ? 'low' : 'healthy'
  const invVal = r => r.stock * (r.price || 0)
  const stPct = (sold, stock) => (sold + stock) ? sold / (sold + stock) * 100 : 0
  
  const riseTier = (sold, stock, soldBase, stockBase) => {
    if (soldBase == null) return null
    const delta = stPct(sold, stock) - stPct(soldBase, stockBase)
    if (delta >= 15) return 'tier3'
    if (delta >= 10) return 'tier2'
    if (delta >= 5) return 'tier1'
    return null
  }
  
  const aggregate = (rows) => {
    const rev = rows.reduce((s,r) => s + r.rev, 0)
    const sold = rows.reduce((s,r) => s + r.sold, 0)
    const stock = rows.reduce((s,r) => s + r.stock, 0)
    const ads = rows.reduce((s,r) => s + r.ads, 0)
    const st = (sold + stock) ? sold / (sold + stock) * 100 : 0
    const avgVal = sold ? rev / sold : 0
    const invValue = rows.reduce((s,r) => s + invVal(r), 0)
    const newCount = rows.filter(r => r.isNew).length
    const neverArrived = rows.filter(isNeverArrived).length
    const stagnant = rows.filter(isStagnant).length
    const under30 = rows.filter(r => ['critical', 'low', 'sold_out'].includes(healthClass(r))).length
    return { rev, sold, stock, ads, st, avgVal, invValue, newCount, under30, neverArrived, stagnant, count: rows.length }
  }

  const buildCategoryMap = (rows) => {
    const map = new Map()
    for (const r of rows) {
      if (!map.has(r.c)) map.set(r.c, [])
      map.get(r.c).push(r)
    }
    return map
  }
  
  const applyFilters = (rows) => {
    return rows.filter(r => {
      if (search && !r.n.toLowerCase().includes(search.toLowerCase())) return false
      if (category !== 'all' && r.c !== category) return false
      if (health !== 'all' && healthClass(r) !== health) return false
      if (r.rev < minRev) return false
      if (notesFilter !== 'all') {
        const note = notes.get(r.n) || ''
        if (notesFilter === 'none' ? note !== '' : note !== notesFilter) return false
      }
      return true
    })
  }

  const _sortRows = (rows, overrideSortBy, overrideSortDir) => {
    const sBy = overrideSortBy || sortBy
    const dir = (overrideSortDir || sortDir) === 'asc' ? 1 : -1
    const key = { rev: 'rev', name: 'n', stock: 'stock', coverage: 'cov', sellthrough: null, invvalue: null, isnew: null }[sBy]
    
    return [...rows].sort((a, b) => {
      if (sBy === 'name') return dir * a.n.localeCompare(b.n)
      if (sBy === 'isnew') {
        const diff = (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0)
        return diff !== 0 ? diff : (b.rev - a.rev)
      }
      if (sBy === 'sellthrough') {
        const sa = a.sold / (a.sold + a.stock || 1)
        const sb = b.sold / (b.sold + b.stock || 1)
        return dir * (sa - sb)
      }
      if (sBy === 'invvalue') return dir * (invVal(a) - invVal(b))
      return dir * ((a[key] || 0) - (b[key] || 0))
    })
  }

  const fmtMoney = v => 'EGP ' + Math.round(v).toLocaleString()
  const fmtNum = v => Math.round(v).toLocaleString()
  const fmt1 = v => Number(v).toFixed(1)

  const pctDelta = (now, prev) => {
    if (prev === 0) return now === 0 ? 0 : null
    return (now - prev) / prev * 100
  }

  const DeltaChip = ({ now, prev, tooltip }) => {
    const d = pctDelta(now, prev)
    if (d === null) return <span className="delta flat" title={tooltip}>— new</span>
    const dir = d > 0.05 ? 'up' : d < -0.05 ? 'down' : 'flat'
    const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '•'
    const sign = d > 0 ? '+' : ''
    return <span className={`delta ${dir}`} title={tooltip}>{arrow} {sign}{d.toFixed(1)}%</span>
  }

  const topCategoriesByDailySales = (rows, n = 5) => {
    const map = buildCategoryMap(rows)
    const list = [...map.entries()].map(([cat, rs]) => ({ cat, ads: rs.reduce((s, r) => s + r.ads, 0) }))
    list.sort((a, b) => b.ads - a.ads)
    return list.slice(0, n)
  }

  const findMatch = (name, rows) => rows.find(r => r.n === name)

  const handleHover = (e, img, name) => {
    const pad = 16
    let x = e.clientX + pad
    let y = e.clientY + pad
    if (x + 184 > window.innerWidth) x = e.clientX - 184 - pad
    if (y + 220 > window.innerHeight) y = e.clientY - 220
    setHoverTip({ visible: true, x, y, img: img || PLACEHOLDER_IMG, name })
  }
  
  const handleMove = (e) => {
    if(!hoverTip.visible) return
    const pad = 16
    let x = e.clientX + pad
    let y = e.clientY + pad
    if (x + 184 > window.innerWidth) x = e.clientX - 184 - pad
    if (y + 220 > window.innerHeight) y = e.clientY - 220
    setHoverTip(prev => ({ ...prev, x, y }))
  }

  const exportFilteredCsv = () => {
    const rows = _sortRows(applyFilters(visRows(period)))
    const headers = ['Product Name','Category','Collected Revenue','Items Sold','Available Stock','Current Price','Inventory Value','Avg Daily Sales','Stock Coverage (days)','Sell-Through %','Stock Health','New Collection','Note']
    const csvEscape = (s) => {
      const str = String(s ?? '')
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
    }
    
    const lines = [headers.map(csvEscape).join(',')]
    for(const r of rows){
      const cls = healthClass(r)
      const st = r.sold/(r.sold+r.stock||1)*100
      const note = notes.get(r.n) || ''
      lines.push([
        r.n, r.c, r.rev.toFixed(2), r.sold, r.stock,
        r.price || '', r.price ? invVal(r).toFixed(2) : '', r.ads, r.cov, st.toFixed(1),
        healthLabel(cls), r.isNew ? 'Yes' : 'No', note ? NOTE_LABELS[note] : ''
      ].map(csvEscape).join(','))
    }
    const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8;'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `dashboard-export_${period?.id || 'data'}_${new Date().toISOString().slice(0,10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const exportFilteredXlsx = async () => {
    const rows = _sortRows(applyFilters(visRows(period)))
    if (rows.length === 0) { alert('No SKUs match the current filters — nothing to export.'); return }
    if (rows.length > 400) {
      if(!window.confirm(`This will fetch and embed photos for ${rows.length} products. That can take a couple of minutes and produce a large file. Continue?`)) return
    }
    
    // Disable buttons state could be added here, but avoiding complex state for brevity
    try {
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Inventory Export')
      ws.columns = [
        {header:'Photo', key:'photo', width: 12},
        {header:'Product Name', key:'name', width:34},
        {header:'Category', key:'cat', width:22},
        {header:'Collected Revenue', key:'rev', width:16},
        {header:'Items Sold', key:'sold', width:11},
        {header:'Available Stock', key:'stock', width:13},
        {header:'Current Price', key:'price', width:12},
        {header:'Inventory Value', key:'invval', width:14},
        {header:'Avg Daily Sales', key:'ads', width:13},
        {header:'Stock Coverage (days)', key:'cov', width:17},
        {header:'Sell-Through %', key:'st', width:13},
        {header:'Stock Health', key:'health', width:13},
        {header:'New Collection', key:'isnew', width:13},
        {header:'Note', key:'note', width:14},
      ]
      ws.getRow(1).font = {bold:true}
      ws.getRow(1).alignment = {vertical:'middle'}
      
      rows.forEach((r, i) => {
        const cls = healthClass(r)
        const st = r.sold/(r.sold+r.stock||1)*100
        const note = notes.get(r.n) || ''
        ws.addRow({
          photo:'', name:r.n, cat:r.c, rev:r.rev, sold:r.sold, stock:r.stock,
          price: r.price || '', invval: r.price ? invVal(r) : '', ads:r.ads, cov:r.cov,
          st: Number(st.toFixed(1)), health: healthLabel(cls), isnew: r.isNew ? 'Yes' : 'No',
          note: note ? NOTE_LABELS[note] : ''
        })
        ws.getRow(i+2).height = 60
      })
      
      // Concurrency helper
      const processWithConcurrency = async (items, limit, worker) => {
        let idx = 0
        const runOne = async () => {
          while (idx < items.length) {
            const i = idx++
            await worker(items[i], i)
          }
        }
        await Promise.all(Array.from({length: Math.min(limit, items.length)}, runOne))
      }
      
      const fetchImageAsResizedBase64 = async (url) => {
        const resp = await fetch(url, {mode:'cors'})
        if(!resp.ok) throw new Error('http '+resp.status)
        const blob = await resp.blob()
        const bitmap = await createImageBitmap(blob)
        const canvas = document.createElement('canvas')
        const scale = Math.min(1, 80 / Math.max(bitmap.width, bitmap.height))
        const w = Math.max(1, Math.round(bitmap.width * scale))
        const h = Math.max(1, Math.round(bitmap.height * scale))
        canvas.width = w; canvas.height = h
        canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
        return { base64: canvas.toDataURL('image/jpeg', 0.85), ext: 'jpeg' }
      }
      
      await processWithConcurrency(rows, 6, async (r, i) => {
        if(!r.img) return
        try {
          const {base64, ext} = await fetchImageAsResizedBase64(r.img)
          const imgId = wb.addImage({base64, extension: ext})
          ws.addImage(imgId, { tl:{col:0.15, row:(i+1)+0.1}, ext:{width:80, height:80} })
        } catch(e) {
          // Ignore failed images
        }
      })
      
      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `dashboard-export-photos_${period?.id || 'data'}_${new Date().toISOString().slice(0,10)}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch (error) {
      alert('Export failed: ' + error.message)
    }
  }

  // --- Rendering Prep ---
  if (isLoading || !serverData) return <div style={{padding:'40px', textAlign:'center'}}>Loading Live Data...</div>
  if (error) return <div style={{padding:'40px', color:'red'}}>Error loading dashboard data. {error.message}</div>
  if (!period) return <div style={{padding:'40px'}}>No data available.</div>

  // Debug: log first row image data
  if (period.rows.length > 0 && typeof window !== 'undefined') {
    console.log('[Dashboard] First row img:', period.rows[0].img)
    console.log('[Dashboard] Total rows with img:', period.rows.filter(r => r.img).length, '/', period.rows.length)
  }

  const rows = visRows(period)
  const agg = aggregate(rows)
  const cAgg = cmpPeriod ? aggregate(visRows(cmpPeriod)) : null
  const revPerDay = agg.rev / (period.days || 1)
  const cRevPerDay = cAgg ? cAgg.rev / (cmpPeriod.days || 1) : null
  const liveSkus = agg.count - agg.neverArrived
  const cLiveSkus = cAgg ? cAgg.count - cAgg.neverArrived : null

  const topCats = topCategoriesByDailySales(rows, 5)
  const cmpCatMap = cmpPeriod ? buildCategoryMap(visRows(cmpPeriod)) : null

  const allFilteredRows = applyFilters(rows)
  const mappedFilteredRows = buildCategoryMap(allFilteredRows)
  const cats = [...mappedFilteredRows.keys()]

  cats.sort((ca, cb) => {
    const aggA = aggregate(mappedFilteredRows.get(ca)), aggB = aggregate(mappedFilteredRows.get(cb))
    const dir = sortDir === 'asc' ? 1 : -1
    if (sortBy === 'name') return dir * ca.localeCompare(cb)
    if (sortBy === 'rev') return dir * (aggA.rev - aggB.rev)
    if (sortBy === 'stock') return dir * (aggA.stock - aggB.stock)
    if (sortBy === 'coverage') {
      const covA = aggA.stock / (aggA.ads || 1)
      const covB = aggB.stock / (aggB.ads || 1)
      return dir * (covA - covB)
    }
    if (sortBy === 'sellthrough') return dir * (aggA.st - aggB.st)
    if (sortBy === 'invvalue') return dir * (aggA.invValue - aggB.invValue)
    if (sortBy === 'isnew') return aggB.newCount - aggA.newCount
    return dir * (aggA.rev - aggB.rev)
  })

  return (
    <div className="wrap">
      <div className="hdr">
        <div className="hdr-left">
          <div className="hdr-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 17l9 5 9-5"/></svg>
          </div>
          <div>
            <h1 className="hdr-title">Category Inventory Pivot &amp; Stock Coverage</h1>
            <div className="hdr-sub">
              {dateFrom && dateTo
                ? <>📅 Showing <strong>{dateFrom}</strong> → <strong>{dateTo}</strong> · hover any product name for a quick image preview</>
                : <>Live figures from your Shopify export · hover any product name for a quick image preview</>}
            </div>
          </div>
        </div>
        <div className="hdr-right">

          <div className="pill-group" id="periodPills">
            {RAW_PERIODS.map(p => (
              <button key={p.id} className={`pill-btn ${p.id === periodId ? 'active' : ''} ${p.status === 'combined' ? 'combined' : ''}`} onClick={() => setPeriodId(p.id)}>
                <span className="dot"></span>{p.status === 'combined' ? 'Σ Whole Range · ' : ''}{p.label}{p.status === 'ongoing' ? ' · ongoing' : ''}
              </button>
            ))}
          </div>
          <div className={`compare-toggle ${newOnly ? 'on' : ''}`} id="newCollectionToggle" onClick={() => setNewOnly(!newOnly)} title="Show only products that are part of the SS26 new collection">
            <span className="switch"></span> 🏷️ New Collection Only
          </div>
        </div>
      </div>

      {/* ── Date Range Filter – top of page, scopes ALL data ── */}
      <div className="date-range-bar date-range-bar--top">
        <span className="date-range-label">📅 Date Range</span>
        <div className="date-range-inputs">
          <div className="date-field">
            <label>From</label>
            <input
              type="date"
              value={pendingFrom}
              onChange={e => setPendingFrom(e.target.value)}
            />
          </div>
          <span className="date-sep">→</span>
          <div className="date-field">
            <label>To</label>
            <input
              type="date"
              value={pendingTo}
              onChange={e => setPendingTo(e.target.value)}
            />
          </div>
          <button
            className="date-apply-btn"
            disabled={!pendingFrom || !pendingTo}
            style={{background:'#5B4FE9',color:'#fff',padding:'8px 22px',borderRadius:'8px',border:'none',fontWeight:700,fontSize:'13px',cursor:'pointer',boxShadow:'0 2px 6px rgba(91,79,233,.35)'}}
            onClick={() => {
              console.log('[Dashboard] Apply clicked:', pendingFrom, '→', pendingTo)
              setDateFrom(pendingFrom)
              setDateTo(pendingTo)
            }}
          >
            Apply
          </button>
          {(dateFrom || dateTo) && (
            <button
              className="date-clear-btn"
              onClick={() => { setDateFrom(''); setDateTo(''); setPendingFrom(''); setPendingTo('') }}
            >
              ✕ Clear
            </button>
          )}
        </div>
        {isValidating && (
          <span className="date-active-badge" style={{background:'#FEF3E2',color:'#D97706'}}>⏳ Loading…</span>
        )}
        {dateFrom && dateTo && !isValidating && (
          <span className="date-active-badge">Filtered: {dateFrom} → {dateTo} · {period.days} days</span>
        )}
      </div>

      <div className={`tag-note ${newOnly ? 'show' : ''}`} id="tagNote">
        <span>🏷️</span><span><b>New Collection Only</b> is on — every card, ranking, and table row below is scoped to the {fmtNum(agg.newCount)} SKUs tagged as part of the SS26 new collection. Toggle it off to see the full catalog again.</span>
      </div>

      <div className="cards" id="cardsRow">
        {[
          { label: 'Accumulated Revenue', val: fmtMoney(agg.rev), cap: `Total over ${fmt1(period.days)} days`, deltaArgs: [revPerDay, cRevPerDay], deltaCap: 'vs daily pace, previous period' },
          { label: 'Sell-Through Rate', val: agg.st.toFixed(2) + '%', cap: 'Sold ÷ (sold + on hand)', bar: Math.min(agg.st, 100), deltaArgs: [agg.st, cAgg?.st], deltaCap: 'vs previous period' },
          { label: 'Total Stock on Hand', val: fmtNum(agg.stock), cap: 'Physical units available', deltaArgs: [agg.stock, cAgg?.stock], deltaCap: 'vs previous period total' },
          { label: 'Total Items Sold', val: fmtNum(agg.sold), cap: `Units sold over ${fmt1(period.days)} days`, deltaArgs: [agg.sold, cAgg?.sold], deltaCap: 'vs previous period total' },
          { label: 'Total Live SKUs', val: fmtNum(liveSkus), cap: `of ${fmtNum(agg.count)} tracked SKUs`, deltaArgs: [liveSkus, cLiveSkus], deltaCap: 'vs previous period' },
          { label: 'Avg Sales per Day', val: fmt1(agg.ads), cap: 'Units / day (whole collection)', deltaArgs: [agg.ads, cAgg?.ads], deltaCap: 'vs previous period pace' },
          { label: 'Avg Sale Value', val: fmtMoney(agg.avgVal), cap: 'Revenue-weighted average', deltaArgs: [agg.avgVal, cAgg?.avgVal], deltaCap: 'vs previous period' },
          { label: 'Total Inventory Value', val: fmtMoney(agg.invValue), cap: 'Stock on hand × current price', deltaArgs: [agg.invValue, cAgg?.invValue], deltaCap: 'vs previous period' },
        ].map((c, i) => (
          <div className="card" key={i}>
            <div className="card-top">
              <div className="card-label">{c.label}</div>
              <div className="card-ico"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5B4FE9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg></div>
            </div>
            <div>
              <div className="card-val">{c.val}</div>
              <div className="card-cap">{c.cap}</div>
              {c.bar !== undefined && <div className="card-bar"><div style={{ width: `${c.bar}%` }}></div></div>}
              {cAgg && <><DeltaChip now={c.deltaArgs[0]} prev={c.deltaArgs[1]} /><div className="delta-cap">{c.deltaCap}</div></>}
            </div>
          </div>
        ))}
        <div className="card risk">
          <div className="card-top">
            <div className="card-label">SKUs &lt; 30 Days Cover</div>
            <div className="card-ico">⚠️</div>
          </div>
          <div>
            <div className="card-val">{agg.under30}</div>
            <div className="card-cap">Selling fast, restock now</div>
            {cAgg && <><DeltaChip now={agg.under30} prev={cAgg.under30} /><div className="delta-cap">vs previous period count</div></>}
          </div>
        </div>
        <div className="card rank">
          <div className="card-top">
            <div className="card-label">Top 5 Types · Avg Sales/Day</div>
            <div className="card-ico">🏆</div>
          </div>
          <div className="rank-list">
            {topCats.map((t, i) => {
              let deltaHtml = null
              if (cmpCatMap) {
                const cRows = cmpCatMap.get(t.cat)
                if (cRows) {
                  const cAds = cRows.reduce((s, r) => s + r.ads, 0)
                  deltaHtml = <DeltaChip now={t.ads} prev={cAds} />
                } else {
                  deltaHtml = <span className="delta flat">— new</span>
                }
              }
              return (
                <div className="rank-row" key={i}>
                  <span className="rank-num">{i + 1}</span>
                  <span className="rank-name">{t.cat}</span>
                  <span className="rank-val">{fmt1(t.ads)}/day</span>
                  {deltaHtml}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="filters">
        <div className="filters-top">
          <div className="filters-title">🔎 Advanced Inventory Filtering<span className="sub">&nbsp;— narrow down categories or find low-stock SKUs</span></div>
        </div>

        <div className="filters-grid">
          <div className="field">
            <label>Search SKU name</label>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="e.g. Cereal Killer, Boyfriend Linen…" />
          </div>
          <div className="field">
            <label>Product category</label>
            <select value={category} onChange={e => setCategory(e.target.value)}>
              <option value="all">All Categories ({new Set(rows.map(r=>r.c)).size})</option>
              {[...new Set(rows.map(r=>r.c))].sort().map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Stock health status</label>
            <select value={health} onChange={e => setHealth(e.target.value)}>
              <option value="all">Show all stock healths</option>
              <option value="critical">Critical (&lt; 15 days)</option>
              <option value="low">Low (15–30 days)</option>
              <option value="healthy">Healthy (&gt; 30 days)</option>
              <option value="sold_out">Sold out (had sales, 0 left)</option>
              <option value="stagnant">No sales yet (in stock, 0 sold)</option>
              <option value="never_arrived">Never arrived (0 stock, 0 sales)</option>
            </select>
          </div>
          <div className="field">
            <label>Min collected revenue <span className="range-val">{fmtMoney(minRev)}</span></label>
            <div className="range-row">
              <input type="range" min="0" max="500000" step="5000" value={minRev} onChange={e => setMinRev(Number(e.target.value))} />
            </div>
          </div>
          <div className="field">
            <label>Filter by notes</label>
            <select value={notesFilter} onChange={e => setNotesFilter(e.target.value)}>
              <option value="all">Show all notes</option>
              <option value="none">No note set</option>
              <option value="watch">👁 Watch</option>
              <option value="price_down">↓ Price Down</option>
              <option value="price_up">↑ Price Up</option>
              <option value="special">⭐ Special Price</option>
            </select>
          </div>
        </div>
        <div className="filters-bottom">
          <div className="sortbar">
            <span style={{fontSize:'12px',color:'var(--sub)',fontWeight:700,alignSelf:'center',marginRight:'2px'}}>Sort by</span>
            {['rev:Revenue','name:Name','stock:Stock','coverage:Coverage','sellthrough:Sell-Through','invvalue:Inv. Value','isnew:New'].map(st => {
              const [val, label] = st.split(':')
              return (
                <button key={val} className={`sort-btn ${sortBy === val ? 'active' : ''}`} onClick={() => {
                  if(sortBy === val) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
                  else { setSortBy(val); setSortDir('desc') }
                }}>
                  {label} <span className="arrow">{sortBy === val ? (sortDir === 'asc' ? '↑' : '↓') : ''}</span>
                </button>
              )
            })}
          </div>
          <div className="link-actions">
            <a href="#" onClick={(e) => { e.preventDefault(); setOpenCats(new Set(cats)) }}>Expand All Categories</a>
            <a href="#" onClick={(e) => { e.preventDefault(); setOpenCats(new Set()) }}>Collapse All</a>
          </div>
        </div>
      </div>

      <div className="pivot-head-row">
        <h3>Category Pivot</h3>
        <div className="pivot-head-right">
          <span className="pivot-count">{allFilteredRows.length} SKUs across {cats.length} categories</span>
          <button className="export-btn" onClick={exportFilteredCsv}>⬇ Export Filtered</button>
          <button className="export-btn xlsx" onClick={exportFilteredXlsx}>🖼️ Export Excel + Photos</button>
        </div>
      </div>

      <div id="pivotList">
        {cats.length === 0 && <div className="empty">No SKUs match the current filters.</div>}
        {cats.map(cat => {
          const catRowsRaw = mappedFilteredRows.get(cat)
          const override = groupSort.get(cat)
          const catRows = _sortRows(catRowsRaw, override?.by, override?.dir)
          
          const catAgg = aggregate(catRows)
          const activeRows = catRows.filter(r => !isNeverArrived(r))
          let cls
          if (activeRows.length === 0) cls = 'never_arrived'
          else if (catRows.filter(isSoldOut).length > 0) cls = 'sold_out'
          else { const a = aggregate(activeRows); cls = covHealthFromDays(a.stock / (a.ads || 1)) }
          
          const isOpen = openCats.has(cat)

          const baselineRows = catRows.filter(r => r.soldMidJul != null)
          let catRiseTier = null
          if(baselineRows.length){
            const soldBase = baselineRows.reduce((s,r) => s + r.soldMidJul, 0)
            const stockBase = baselineRows.reduce((s,r) => s + r.stockMidJul, 0)
            const soldNow = baselineRows.reduce((s,r) => s + r.sold, 0)
            const stockNow = baselineRows.reduce((s,r) => s + r.stock, 0)
            catRiseTier = riseTier(soldNow, stockNow, soldBase, stockBase)
          }

          return (
            <div className={`group ${isOpen ? 'open' : ''}`} key={cat}>
              <div className="group-head" onClick={() => {
                const next = new Set(openCats)
                if (next.has(cat)) next.delete(cat)
                else next.add(cat)
                setOpenCats(next)
              }}>
                <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 6l6 6-6 6"/></svg>
                <div className="group-title">
                  <div className="name">{cat} <span className="chip">{catRows.length} SKUs</span></div>
                  <div className="sub">Total grouped assets summary</div>
                </div>
                <div className="group-stats">
                  <div className="gstat"><div className="k">Accumulated Rev</div><div className="v">{fmtMoney(catAgg.rev)}</div></div>
                  <div className="gstat"><div className="k">Group Stock</div><div className="v">{fmtNum(catAgg.stock)}</div></div>
                  <div className="gstat"><div className="k">Avg Sales/Day</div><div className="v">{fmt1(catAgg.ads)}</div></div>
                  <div className="gstat"><div className="k">Sell-Through</div><div className="v">{catAgg.st.toFixed(2)}%</div></div>
                  <div className="gstat"><div className="k">Inventory Value</div><div className="v">{fmtMoney(catAgg.invValue)}</div></div>
                </div>
                {catAgg.neverArrived > 0 && cls !== 'never_arrived' && <span className="chip warn">📦 {catAgg.neverArrived} never arrived</span>}
                {catAgg.stagnant > 0 && cls !== 'stagnant' && <span className="chip watch">🍋 {catAgg.stagnant} no sales</span>}
                {!newOnly && catRows.some(r => r.isNew) && <span className="chip newcol">🏷️ {catRows.filter(r => r.isNew).length} new</span>}
                {catRiseTier && <span className={`rise-badge ${catRiseTier}`} title={`Category sell-through vs mid-July: ${RISE_TIER_LABEL[catRiseTier]}`}>⬆ {RISE_TIER_LABEL[catRiseTier]}</span>}
                <span className={`tag ${cls}`}>{healthLabel(cls)}</span>
                
                <select className="group-sort-select" onClick={e => e.stopPropagation()} onChange={e => {
                  e.stopPropagation()
                  const by = e.target.value
                  const dir = { isnew:'desc', rev:'desc', stock:'desc', invvalue:'desc', sellthrough:'desc', coverage:'asc', name:'asc' }[by]
                  const nextSort = new Map(groupSort)
                  if(by) nextSort.set(cat, {by, dir})
                  else nextSort.delete(cat)
                  setGroupSort(nextSort)
                  const nextOpen = new Set(openCats)
                  nextOpen.add(cat)
                  setOpenCats(nextOpen)
                }} value={override?.by || ''}>
                  <option value="">Sort: default</option>
                  <option value="isnew">New First</option>
                  <option value="rev">Top by Revenue</option>
                  <option value="stock">Top by Stock</option>
                  <option value="invvalue">Top by Inv. Value</option>
                  <option value="sellthrough">Top by Sell-Through</option>
                  <option value="coverage">Lowest Coverage</option>
                  <option value="name">Name A–Z</option>
                </select>
                <button className="del-cat-btn" onClick={e => {
                  e.stopPropagation()
                  if(window.confirm(`Remove the entire "${cat}" type from the dashboard?`)){
                    const nextDel = new Set(deletedCats)
                    nextDel.add(cat)
                    setDeletedCats(nextDel)
                  }
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                </button>
              </div>
              {isOpen && (
                <div className="group-body" style={{display: 'block'}}>
                  <table className="sku-table">
                    <thead><tr>
                      <th>SKU Product Name</th><th>Collected Revenue</th><th>Items Sold</th><th>Available Stock</th>
                      <th>Current Price</th><th>Inventory Value</th><th>Avg Daily Sales</th><th>Stock Coverage</th><th>Sell-Through</th><th>Notes</th><th></th>
                    </tr></thead>
                    <tbody>
                      {catRows.map(r => {
                        const rcls = healthClass(r)
                        const st = r.sold/(r.sold+r.stock||1)*100
                        const covText = rcls === 'never_arrived' ? 'Never arrived' : rcls === 'sold_out' ? 'Sold out' : rcls === 'stagnant' ? 'No sales yet' : `${fmt1(r.cov)} days`
                        const currentNote = notes.get(r.n) || ''
                        const rTier = riseTier(r.sold, r.stock, r.soldMidJul, r.stockMidJul)
                        return (
                          <tr key={r.n}>
                            <td className="sku-name hoverable" onMouseEnter={e => handleHover(e, r.img, r.n)} onMouseMove={handleMove} onMouseLeave={() => setHoverTip(prev => ({...prev, visible: false}))}>
                              <div className="sku-name-inner">
                                {r.img
                                  ? <img
                                      src={proxyImg(r.img)}
                                      className="row-thumb"
                                      width="28" height="28" alt=""
                                      onError={e => { e.currentTarget.style.display = 'none' }}
                                    />
                                  : <div className="row-thumb-placeholder" />}
                                <span>{r.n}</span>
                                {r.isNew && <span className="new-collection-badge">NEW</span>}
                                {currentNote && <span className={`note-badge note-${currentNote}`}>{NOTE_ICONS[currentNote]} {NOTE_LABELS[currentNote]}</span>}
                                {rTier && <span className={`rise-badge ${rTier}`}>⬆ {RISE_TIER_LABEL[rTier]}</span>}
                              </div>
                            </td>
                            <td>{fmtMoney(r.rev)}</td>
                            <td>{fmtNum(r.sold)}</td>
                            <td>{fmtNum(r.stock)}</td>
                            <td>{r.price ? fmtMoney(r.price) : '—'}</td>
                            <td>{r.price ? fmtMoney(invVal(r)) : '—'}</td>
                            <td>{fmt1(r.ads)}</td>
                            <td><span className={`cov-pill ${rcls}`}>{covText}</span></td>
                            <td className="st-cell"><span className="st-num">{st.toFixed(1)}%</span><div className="st-bar"><div style={{width: `${Math.min(st,100)}%`}}></div></div></td>
                            <td>
                              <select className={`notes-select note-${currentNote || 'none'}`} value={currentNote} onChange={e => {
                                const val = e.target.value
                                const nextNotes = new Map(notes)
                                if (val) nextNotes.set(r.n, val)
                                else nextNotes.delete(r.n)
                                setNotes(nextNotes)
                              }}>
                                <option value="">—</option>
                                <option value="watch">👁 Watch</option>
                                <option value="price_down">↓ Price Down</option>
                                <option value="price_up">↑ Price Up</option>
                                <option value="special">⭐ Special Price</option>
                              </select>
                            </td>
                            <td>
                              <button className="del-row-btn" onClick={() => {
                                const next = new Set(deletedSkus)
                                next.add(r.n)
                                setDeletedSkus(next)
                              }}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
      
      {(deletedSkus.size > 0 || deletedCats.size > 0) && (
        <div className="removed-bar" style={{display: 'flex'}}>
          <span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
            &nbsp;{deletedSkus.size > 0 ? `${deletedSkus.size} SKU(s)` : ''} {deletedSkus.size > 0 && deletedCats.size > 0 ? 'and' : ''} {deletedCats.size > 0 ? `${deletedCats.size} type(s)` : ''} hidden from this dashboard
          </span>
          <a href="#" onClick={e => { e.preventDefault(); setDeletedSkus(new Set()); setDeletedCats(new Set()) }}>Restore all</a>
        </div>
      )}

      {hoverTip.visible && (
        <div id="imgTip" style={{display: 'block', left: hoverTip.x, top: hoverTip.y}}>
          {hoverTip.img && <img
            src={proxyImg(hoverTip.img)}
            alt=""
            onError={e => { e.currentTarget.style.display = 'none' }}
          />}
          <div className="cap">{hoverTip.name}</div>
        </div>
      )}
    </div>
  )
}
