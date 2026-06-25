// ========== Recruit Dashboard App ==========

let DATA = null;           // 完整解密後資料
let FILTERED = null;       // 套用篩選後的視圖資料
let JOB_TYPE_FILTER = '';  // 職缺類型篩選
let CHARTS = {};           // Chart.js 實例,切換時要 destroy
let FUNNEL_DATA = null;    // 招募漏斗 FB 廣告效益（每天 08:00 自動更新）
let FUNNEL_BYJOB_SORT = { key: 'fb_leads', desc: true };
let REFERRAL_DATA = null;  // 內部推薦管道（手動 JSON）

// ========== 1. 載入 + 解密 ==========
async function loadData() {
  // 優先試加密版,失敗 fallback 到 plain (本機 dev 用)
  try {
    const r = await fetch('data/data.encrypted.json', { cache: 'no-store' });
    if (r.ok) {
      const text = await r.text();
      return { encrypted: true, payload: text.trim() };
    }
  } catch (e) {}
  const r2 = await fetch('data/data.json', { cache: 'no-store' });
  if (r2.ok) {
    return { encrypted: false, payload: await r2.json() };
  }
  throw new Error('找不到資料檔');
}

async function tryLogin(event) {
  event.preventDefault();
  const pwd = document.getElementById('pwd').value;
  const errEl = document.getElementById('login-error');
  const btn = event.target.querySelector('button[type="submit"]');
  const origText = btn.innerHTML;
  errEl.classList.add('hidden');
  btn.disabled = true;
  btn.innerHTML = `<span class="inline-flex items-center gap-2">
    <svg class="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="40 60"/></svg>
    解密載入中...
  </span>`;

  const restore = () => { btn.disabled = false; btn.innerHTML = origText; };

  let loaded;
  try {
    loaded = await loadData();
  } catch (e) {
    errEl.textContent = '資料載入失敗: ' + e.message;
    errEl.classList.remove('hidden');
    restore();
    return;
  }

  let data;
  if (loaded.encrypted) {
    try {
      const decrypted = CryptoJS.AES.decrypt(loaded.payload, pwd).toString(CryptoJS.enc.Utf8);
      if (!decrypted) throw new Error('密碼錯誤');
      data = JSON.parse(decrypted);
    } catch (e) {
      errEl.textContent = '密碼錯誤,無法解開資料';
      errEl.classList.remove('hidden');
      restore();
      return;
    }
  } else {
    data = loaded.payload;
  }

  DATA = data;
  FILTERED = data;
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  initFilters();
  render();
  // 招募漏斗資料獨立載入（不受密碼保護的 JSON，每天 08:00 自動產生）
  loadFunnel();
  loadReferral();
}

async function loadReferral() {
  try {
    // 優先用 data.json 內嵌（GitHub Pages 路線）；失敗 fallback dev_server /external-data/
    if (DATA?.recruitment_effectiveness?.referral) {
      REFERRAL_DATA = DATA.recruitment_effectiveness.referral;
    } else {
      let r = await fetch('/external-data/recruitment_referral_stats.json', { cache: 'no-store' });
      if (!r.ok) {
        r = await fetch('/external-data/manual/referral_stats.json', { cache: 'no-store' });
        if (!r.ok) throw new Error('找不到 referral_stats.json');
      }
      REFERRAL_DATA = await r.json();
    }
    renderReferralSection();
    renderChannelOverview();
  } catch (e) {
    console.warn('[referral] 載入失敗：', e.message);
  }
}

async function loadFunnel() {
  try {
    // 優先用 data.json 內嵌（GitHub Pages 路線）；失敗 fallback dev_server /external-data/
    if (DATA?.recruitment_effectiveness?.funnel) {
      FUNNEL_DATA = DATA.recruitment_effectiveness.funnel;
    } else {
      const r = await fetch('/external-data/recruitment_funnel.json', { cache: 'default' });
      if (!r.ok) {
        const r2 = await fetch('data/recruitment_funnel.json', { cache: 'default' });
        if (!r2.ok) throw new Error('找不到 recruitment_funnel.json');
        FUNNEL_DATA = await r2.json();
      } else {
        FUNNEL_DATA = await r.json();
      }
    }
    renderFunnelSection();
    renderChannelOverview();
  } catch (e) {
    console.warn('[funnel] 載入失敗：', e.message);
  }
}

function logout() {
  location.reload();
}

// ========== 2. 篩選器 ==========
function initFilters() {
  const deptSel = document.getElementById('filter-dept');
  const titleSel = document.getElementById('filter-title');
  DATA.departments.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.name;
    opt.textContent = `${d.name} (在職 ${d.current})`;
    deptSel.appendChild(opt);
  });
  DATA.positions_summary.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = `${p.name} (在職 ${p.current})`;
    titleSel.appendChild(opt);
  });
  deptSel.addEventListener('change', applyFilters);
  titleSel.addEventListener('change', applyFilters);

  // 日期月份下拉:從資料推算可選範圍 (取資料最早月 ~ 當月)
  const year = DATA.meta.year;
  const today = new Date();
  const maxMonth = today.getFullYear() === year ? today.getMonth() + 1 : 12;
  const fromSel = document.getElementById('filter-month-from');
  const toSel = document.getElementById('filter-month-to');
  for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${String(m).padStart(2, '0')}`;
    const disabled = m > maxMonth ? 'disabled' : '';
    fromSel.insertAdjacentHTML('beforeend', `<option value="${ym}" ${disabled}>${ym}</option>`);
    toSel.insertAdjacentHTML('beforeend', `<option value="${ym}" ${disabled}>${ym}</option>`);
  }
  // 預設: 年初 ~ 當月
  fromSel.value = `${year}-01`;
  toSel.value = `${year}-${String(maxMonth).padStart(2, '0')}`;
  fromSel.addEventListener('change', applyFilters);
  toSel.addEventListener('change', applyFilters);
}

function setDateRange(preset) {
  const year = DATA.meta.year;
  const today = new Date();
  const curMonth = today.getFullYear() === year ? today.getMonth() + 1 : 12;
  const fromSel = document.getElementById('filter-month-from');
  const toSel = document.getElementById('filter-month-to');
  let from, to;
  switch (preset) {
    case 'this_month':
      from = to = `${year}-${String(curMonth).padStart(2, '0')}`;
      break;
    case 'last_month':
      const lm = curMonth - 1 || 12;
      from = to = `${year}-${String(lm).padStart(2, '0')}`;
      break;
    case 'q':
      const qStart = Math.floor((curMonth - 1) / 3) * 3 + 1;
      from = `${year}-${String(qStart).padStart(2, '0')}`;
      to = `${year}-${String(curMonth).padStart(2, '0')}`;
      break;
    case 'ytd':
    default:
      from = `${year}-01`;
      to = `${year}-${String(curMonth).padStart(2, '0')}`;
  }
  fromSel.value = from;
  toSel.value = to;
  applyFilters();
}

function resetFilters() {
  document.getElementById('filter-dept').value = '';
  document.getElementById('filter-title').value = '';
  JOB_TYPE_FILTER = '';
  setDateRange('ytd');
}

function filterJobType(t) {
  JOB_TYPE_FILTER = t;
  render();
}

function applyFilters() {
  const dept = document.getElementById('filter-dept').value;
  const title = document.getElementById('filter-title').value;
  const monthFrom = document.getElementById('filter-month-from').value;  // "2026-01"
  const monthTo = document.getElementById('filter-month-to').value;      // "2026-06"

  // 篩選邏輯: 對 resignation_list / new_hire_list / open_positions / departments / monthly_trend 全部篩選
  const matchDept = r => !dept || r.dept === dept;
  const matchTitle = r => !title || r.title === title;
  const inMonthRange = (dateStr) => {
    if (!dateStr) return false;
    const ym = dateStr.slice(0, 7);
    return ym >= monthFrom && ym <= monthTo;
  };
  const inMonthRangeOpt = (dateStr) => !dateStr || (dateStr.slice(0, 7) >= monthFrom && dateStr.slice(0, 7) <= monthTo);

  // 個人層級 -- 按事件發生日期篩選
  const resigns = DATA.resignation_list.filter(r =>
    matchDept(r) && matchTitle(r) && inMonthRange(r.leave)
  );
  const newHires = DATA.new_hire_list.filter(r =>
    matchDept(r) && matchTitle(r) && inMonthRange(r.start)
  );
  const shortTerm = DATA.short_term_resignations.filter(r =>
    matchDept(r) && matchTitle(r) &&
    (inMonthRange(r.leave) || inMonthRange(r.start))
  );
  // 職缺: 用月份欄位篩選 (1~12)
  const fromM = parseInt(monthFrom.slice(5, 7));
  const toM = parseInt(monthTo.slice(5, 7));
  const positions = DATA.open_positions.filter(p =>
    (!dept || p.biz === dept || p.course === dept) &&
    (!title || p.position === title) &&
    (p.month >= fromM && p.month <= toM)
  );
  // 部門表：依篩選區間重算 (而非用 DATA 預存的 YTD 值)
  // 用 resigns/newHires + positions 重算每部門的 離職/到職/淨增減/流失率
  const _deptMap = {};
  DATA.departments.forEach(d => {
    _deptMap[d.name] = {
      name: d.name,
      current: d.current,
      resignations: 0,
      new_hires: 0,
      net: 0,
      open_new: 0,
      open_backfill: 0,
      hired_new: 0,
      hired_backfill: 0,
      pending_fill: 0,
      turnover_rate: 0,
    };
  });
  resigns.forEach(r => {
    if (!_deptMap[r.dept]) _deptMap[r.dept] = { name: r.dept, current: 0, resignations: 0, new_hires: 0, net: 0, open_new: 0, open_backfill: 0, hired_new: 0, hired_backfill: 0, pending_fill: 0, turnover_rate: 0 };
    _deptMap[r.dept].resignations += 1;
  });
  newHires.forEach(n => {
    if (!_deptMap[n.dept]) _deptMap[n.dept] = { name: n.dept, current: 0, resignations: 0, new_hires: 0, net: 0, open_new: 0, open_backfill: 0, hired_new: 0, hired_backfill: 0, pending_fill: 0, turnover_rate: 0 };
    _deptMap[n.dept].new_hires += 1;
  });
  positions.forEach(p => {
    const k = p.course || p.biz;
    if (!k) return;
    if (!_deptMap[k]) _deptMap[k] = { name: k, current: 0, resignations: 0, new_hires: 0, net: 0, open_new: 0, open_backfill: 0, hired_new: 0, hired_backfill: 0, pending_fill: 0, turnover_rate: 0 };
    if (p.type === '新增') {
      _deptMap[k].open_new += p.demand;
      _deptMap[k].hired_new += p.hired;
    } else if (p.type === '離職遞補') {
      _deptMap[k].open_backfill += p.demand;
      _deptMap[k].hired_backfill += p.hired;
    }
  });
  Object.values(_deptMap).forEach(d => {
    d.net = d.new_hires - d.resignations;
    // 部門級流失率：離職 ÷ ((期初+期末)/2)；期初推估 = 現在 + 離職 - 新進
    const start = d.current + d.resignations - d.new_hires;
    const avg = (start + d.current) / 2;
    d.turnover_rate = avg > 0 ? Math.round(d.resignations / avg * 1000) / 10 : 0;
    d.pending_fill = Math.max((d.open_new + d.open_backfill) - (d.hired_new + d.hired_backfill), 0);
  });
  const depts = dept ? Object.values(_deptMap).filter(d => d.name === dept) : Object.values(_deptMap).sort((a, b) => b.resignations - a.resignations);
  const titles = title ? DATA.positions_summary.filter(t => t.name === title) : DATA.positions_summary;

  // 重算 KPI
  const ytdResign = resigns.length;
  const ytdNew = newHires.length;
  const stillActive = newHires.filter(n => n.still_active).length;
  let currentActive;
  if (dept && title) {
    // 雙篩選：從 dept_title_active 矩陣取交集
    const m = (DATA.dept_title_active || []).find(x => x.dept === dept && x.title === title);
    currentActive = m ? m.current : 0;
  } else if (dept) {
    currentActive = (DATA.departments.find(d => d.name === dept) || {}).current || 0;
  } else if (title) {
    currentActive = (DATA.positions_summary.find(t => t.name === title) || {}).current || 0;
  } else {
    currentActive = DATA.kpi.current_active;
  }

  // 月度趨勢:只顯示篩選區間月份
  // 無 dept/title 篩選時用 DATA 預算的(含 active_end/turnover_rate)
  // 有 dept/title 時重算 resignations/new_hires (active_end 仍沿用全公司,無法精算到部門級期末在職)
  const monthlyTrend = DATA.monthly_trend
    .filter(m => m.month >= monthFrom && m.month <= monthTo)
    .map(m => {
      if (!dept && !title) return { ...m };
      const rThis = resigns.filter(r => r.leave && r.leave.slice(0, 7) === m.month).length;
      const nThis = newHires.filter(n => n.start && n.start.slice(0, 7) === m.month).length;
      return { ...m, resignations: rThis, new_hires: nThis, net: nThis - rThis };
    });

  // 離職原因重算
  const reasonCounter = {};
  resigns.forEach(r => {
    reasonCounter[r.reason] = (reasonCounter[r.reason] || 0) + 1;
  });
  const total = resigns.length;
  const reasons = Object.entries(reasonCounter)
    .map(([k, v]) => ({ reason: k, count: v, pct: total ? Math.round(v / total * 1000) / 10 : 0 }))
    .sort((a, b) => b.count - a.count);

  // 年資分布重算
  const BUCKETS = [
    ['未滿 1 個月', 0, 30], ['1~3 個月', 31, 90], ['3~6 個月', 91, 180],
    ['6 個月~1 年', 181, 365], ['1~3 年', 366, 1095], ['3~5 年', 1096, 1825],
    ['5~10 年', 1826, 3650], ['10 年以上', 3651, 99999]
  ];
  const tenureDist = BUCKETS.map(([label, lo, hi]) => ({
    bucket: label,
    count: resigns.filter(r => r.tenure_days != null && r.tenure_days >= lo && r.tenure_days <= hi).length
  }));

  // 期間流失率: 離職 / 期末在職
  // 無 dept/title 篩選時用全公司期末在職(從 monthly_trend);有篩選時用該部門/職務當下在職
  let endActive = currentActive;
  if (!dept && !title && monthlyTrend.length > 0) {
    const lastM = monthlyTrend[monthlyTrend.length - 1];
    if (lastM.active_end) endActive = lastM.active_end;
  }
  const periodTurnover = endActive ? Math.round(ytdResign / endActive * 1000) / 10 : 0;
  // 期間遞補完成率: 有 matched_new_hire 的離職人數（含提前補位）/ 期間離職數
  // （與下方「遞補空窗分析」區塊口徑一致；提前補位也算遞補完成）
  const bfMatched = resigns.filter(r => r.matched_new_hire).length;
  const periodBackfill = ytdResign ? Math.round(bfMatched / ytdResign * 1000) / 10 : 0;

  // Label 前綴: 全年顯示 YTD,部分顯示期間
  const today = new Date();
  const maxM = today.getFullYear() === DATA.meta.year ? today.getMonth() + 1 : 12;
  const isFullYTD = monthFrom === `${DATA.meta.year}-01` && monthTo === `${DATA.meta.year}-${String(maxM).padStart(2, '0')}`;
  const periodLabel = isFullYTD ? '今年至今' : (monthFrom === monthTo ? monthFrom.replace('-', '/') : `${monthFrom.replace('-', '/')}~${monthTo.replace('-', '/')}`);

  // 104 招募效益：依部門篩選
  const re = DATA.recruitment_effectiveness || {};
  const w104 = re.weekly_104;
  let weekly_104 = w104;
  if (w104 && dept) {
    const matchD = (x) => x && x.dept === dept;
    const filteredDepts = (w104.departments || []).filter(matchD);
    const filteredTop = (w104.top_jobs_by_app || []).filter(matchD);
    const filteredTopPV = (w104.top_jobs_by_pv || []).filter(matchD);
    const filteredLow = (w104.low_conversion_jobs || []).filter(matchD);
    const sumPV = filteredDepts.reduce((s, x) => s + (x.total_pv || 0), 0);
    const sumApp = filteredDepts.reduce((s, x) => s + (x.total_app || 0), 0);
    const sumJobs = filteredDepts.reduce((s, x) => s + (x.job_count || 0), 0);
    weekly_104 = {
      ...w104,
      departments: filteredDepts,
      top_jobs_by_app: filteredTop,
      top_jobs_by_pv: filteredTopPV,
      low_conversion_jobs: filteredLow,
      total_pv: sumPV,
      total_app: sumApp,
      total_active_jobs: sumJobs,
      avg_conversion_rate: sumPV ? Math.round(sumApp / sumPV * 10000) / 100 : 0,
      // 部門篩選後不顯示「未分類警示」（那是全公司層級的）
      unmatched_jobs: [],
    };
  }

  FILTERED = {
    ...DATA,
    recruitment_effectiveness: { ...re, weekly_104 },
    kpi: {
      ...DATA.kpi,
      current_active: currentActive,
      ytd_resignations: ytdResign,
      ytd_new_hires: ytdNew,
      ytd_short_term_resign: shortTerm.length,
      ytd_turnover_rate: periodTurnover,
      ytd_backfill_completion: periodBackfill,
      ytd_open_positions: positions.reduce((s, p) => s + p.demand, 0),
      ytd_filled: positions.reduce((s, p) => s + p.hired, 0),
      ytd_pending_fill: positions.reduce((s, p) => s + p.pending, 0),
      period_label: periodLabel,
    },
    departments: depts,
    positions_summary: titles,
    monthly_trend: monthlyTrend,
    resignation_reasons: reasons,
    tenure_distribution: tenureDist,
    short_term_resignations: shortTerm,
    open_positions: positions,
    resignation_list: resigns,
    new_hire_list: newHires,
  };

  render();
}

// ========== 3. 渲染 ==========
function renderEmptyStateBanner() {
  const dept = document.getElementById('filter-dept').value;
  const banner = document.getElementById('empty-state-banner');
  if (!banner) return;
  const k = FILTERED.kpi;
  if (dept && k.ytd_resignations === 0 && k.ytd_new_hires === 0) {
    document.getElementById('empty-state-dept').textContent = dept;
    document.getElementById('empty-state-resign').textContent = k.ytd_resignations;
    document.getElementById('empty-state-new').textContent = k.ytd_new_hires;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function render() {
  renderEmptyStateBanner();
  renderMeta();
  renderKPI();
  renderMonthlyChart();
  renderReasonsChart();
  renderTenureChart();
  renderShortTermChart();
  renderShortTermTable();
  renderBackfillAnalysis();
  renderLeaveTracking();
  renderYoYCompare();
  renderHighTurnoverFocus();
  renderDeptTable();
  renderPositionsTable();
  renderChannelOverview();
  renderReferralSection();
  renderFunnelSection();
  renderJobBanksSection();
  renderResignTable();
  renderNewHireTable();
}

// ========== 人力銀行招募效益（104 + 1111 並列） ==========
let JB_DEPT_SORT = { key: 'total_app', desc: true };

function renderJobBanksSection() {
  const sec = document.getElementById('section-jobbanks');
  if (!sec) return;
  const src = FILTERED || DATA;
  const re = src.recruitment_effectiveness || {};
  const d104 = re.weekly_104;
  const d1111 = re.weekly_1111;
  if (!d104 && !d1111) { sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');

  // 期間（兩平台分開顯示，因為下載週期可能不同）
  const periodsEl = document.getElementById('jb-periods');
  periodsEl.innerHTML =
    (d104 ? `<span>🔵 104：${d104.week_start} ~ ${d104.week_end}</span>` : '') +
    (d1111 ? `<span>🟣 1111：${d1111.week_start} ~ ${d1111.week_end}</span>` : '');

  // 合計卡片
  const pv104 = d104 ? d104.total_pv : 0;
  const pv1111 = d1111 ? d1111.total_pv : 0;
  const app104 = d104 ? d104.total_app : 0;
  const app1111 = d1111 ? d1111.total_app : 0;
  const jobs104 = d104 ? d104.total_active_jobs : 0;
  const jobs1111 = d1111 ? d1111.total_active_jobs : 0;
  const totalPv = pv104 + pv1111;
  const totalApp = app104 + app1111;
  const totalConv = totalPv ? (totalApp / totalPv * 100).toFixed(2) : 0;

  document.getElementById('jb-pv').textContent = fmtNum(totalPv);
  document.getElementById('jb-pv-104').textContent = d104 ? fmtNum(pv104) : '—';
  document.getElementById('jb-pv-1111').textContent = d1111 ? fmtNum(pv1111) : '—';
  document.getElementById('jb-app').textContent = fmtNum(totalApp);
  document.getElementById('jb-app-104').textContent = d104 ? fmtNum(app104) : '—';
  document.getElementById('jb-app-1111').textContent = d1111 ? fmtNum(app1111) : '—';
  document.getElementById('jb-conv').textContent = totalConv + '%';
  document.getElementById('jb-conv-104').textContent = d104 ? d104.avg_conversion_rate + '%' : '—';
  document.getElementById('jb-conv-1111').textContent = d1111 ? d1111.avg_conversion_rate + '%' : '—';
  document.getElementById('jb-jobs').textContent = fmtNum(jobs104 + jobs1111);
  document.getElementById('jb-jobs-104').textContent = d104 ? fmtNum(jobs104) : '—';
  document.getElementById('jb-jobs-1111').textContent = d1111 ? fmtNum(jobs1111) : '—';

  renderJbCompareChart(pv104, pv1111, app104, app1111);
  renderJbDeptStackChart(d104, d1111);
  renderJbDeptTable(d104, d1111);
  renderJbTopJobs('jb-104-top', d104, 'blue');
  renderJbTopJobs('jb-1111-top', d1111, 'purple');
  renderJbUnmatched(d104, d1111);
  renderJbLowConv(d104, d1111);
}

function renderJbCompareChart(pv104, pv1111, app104, app1111) {
  destroyChart('jbCompare');
  const ctx = document.getElementById('chart-jb-compare');
  if (!ctx) return;
  CHARTS.jbCompare = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['瀏覽', '履歷', '轉換 ×100'],
      datasets: [
        {
          label: '104',
          backgroundColor: '#3b82f6',
          data: [pv104, app104, pv104 ? Math.round(app104 / pv104 * 10000) / 100 : 0],
        },
        {
          label: '1111',
          backgroundColor: '#a855f7',
          data: [pv1111, app1111, pv1111 ? Math.round(app1111 / pv1111 * 10000) / 100 : 0],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: (c) => {
              const lab = c.dataset.label;
              const v = c.parsed.y;
              if (c.dataIndex === 2) return ` ${lab}: ${v}% （轉換率）`;
              return ` ${lab}: ${fmtNum(v)}`;
            }
          }
        }
      },
      scales: { y: { beginAtZero: true } }
    }
  });
}

// 合併 104/1111 部門到一張表
function mergeJbDepartments(d104, d1111) {
  const map = {};
  const add = (deptList, key) => (deptList || []).forEach(d => {
    const k = d.dept;
    if (!map[k]) map[k] = { dept: k, pv_104: 0, app_104: 0, pv_1111: 0, app_1111: 0, jobs_104: 0, jobs_1111: 0 };
    map[k]['pv_' + key] += d.total_pv || 0;
    map[k]['app_' + key] += d.total_app || 0;
    map[k]['jobs_' + key] += d.job_count || 0;
  });
  if (d104) add(d104.departments, '104');
  if (d1111) add(d1111.departments, '1111');
  return Object.values(map).map(r => ({
    ...r,
    total_pv: r.pv_104 + r.pv_1111,
    total_app: r.app_104 + r.app_1111,
    total_jobs: r.jobs_104 + r.jobs_1111,
    conv: (r.pv_104 + r.pv_1111) ? Math.round((r.app_104 + r.app_1111) / (r.pv_104 + r.pv_1111) * 10000) / 100 : 0,
  }));
}

function renderJbDeptStackChart(d104, d1111) {
  destroyChart('jbDeptStack');
  const ctx = document.getElementById('chart-jb-dept-stack');
  if (!ctx) return;
  const merged = mergeJbDepartments(d104, d1111)
    .sort((a, b) => b.total_app - a.total_app)
    .slice(0, 10);
  CHARTS.jbDeptStack = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: merged.map(r => r.dept),
      datasets: [
        { label: '104 履歷', data: merged.map(r => r.app_104), backgroundColor: '#3b82f6' },
        { label: '1111 履歷', data: merged.map(r => r.app_1111), backgroundColor: '#a855f7' },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: { x: { stacked: true, beginAtZero: true }, y: { stacked: true } }
    }
  });
}

function renderJbDeptTable(d104, d1111) {
  const merged = mergeJbDepartments(d104, d1111);
  const sk = JB_DEPT_SORT;
  const sorted = merged.sort((a, b) => {
    const av = a[sk.key] ?? 0, bv = b[sk.key] ?? 0;
    if (typeof av === 'string') return sk.desc ? bv.localeCompare(av) : av.localeCompare(bv);
    return sk.desc ? bv - av : av - bv;
  });
  const arrow = (k) => sk.key === k ? (sk.desc ? ' ▼' : ' ▲') : '';
  const th = (k, label, cls = '') => `<th class="px-3 py-2 text-xs font-medium text-slate-600 cursor-pointer hover:bg-slate-100 ${cls}" onclick="sortJbDept('${k}')">${label}${arrow(k)}</th>`;
  // 總計列
  const tot = merged.reduce((a, r) => {
    a.pv_104 += r.pv_104; a.app_104 += r.app_104;
    a.pv_1111 += r.pv_1111; a.app_1111 += r.app_1111;
    a.total_pv += r.total_pv; a.total_app += r.total_app;
    a.total_jobs += r.total_jobs;
    return a;
  }, { pv_104: 0, app_104: 0, pv_1111: 0, app_1111: 0, total_pv: 0, total_app: 0, total_jobs: 0 });
  const totConv = tot.total_pv ? (tot.total_app / tot.total_pv * 100).toFixed(2) : 0;
  const rows = sorted.map(r => `
    <tr class="border-t border-slate-100 hover:bg-slate-50">
      <td class="px-3 py-2 text-sm font-medium">${r.dept}</td>
      <td class="px-3 py-2 text-sm text-right text-blue-600">${fmtNum(r.app_104)}</td>
      <td class="px-3 py-2 text-sm text-right text-slate-400">${fmtNum(r.pv_104)}</td>
      <td class="px-3 py-2 text-sm text-right text-purple-600">${fmtNum(r.app_1111)}</td>
      <td class="px-3 py-2 text-sm text-right text-slate-400">${fmtNum(r.pv_1111)}</td>
      <td class="px-3 py-2 text-sm text-right font-bold text-emerald-700">${fmtNum(r.total_app)}</td>
      <td class="px-3 py-2 text-sm text-right text-slate-500">${fmtNum(r.total_pv)}</td>
      <td class="px-3 py-2 text-sm text-right font-semibold ${r.conv < 2 ? 'text-amber-600' : 'text-emerald-600'}">${r.conv}%</td>
      <td class="px-3 py-2 text-xs text-slate-400 text-right">${r.total_jobs}</td>
    </tr>
  `).join('');
  const totRow = `
    <tr class="border-t-2 border-slate-300 bg-slate-100 font-bold">
      <td class="px-3 py-2 text-sm">總計（${merged.length} 部門）</td>
      <td class="px-3 py-2 text-sm text-right text-blue-700">${fmtNum(tot.app_104)}</td>
      <td class="px-3 py-2 text-sm text-right text-slate-500">${fmtNum(tot.pv_104)}</td>
      <td class="px-3 py-2 text-sm text-right text-purple-700">${fmtNum(tot.app_1111)}</td>
      <td class="px-3 py-2 text-sm text-right text-slate-500">${fmtNum(tot.pv_1111)}</td>
      <td class="px-3 py-2 text-sm text-right text-emerald-800">${fmtNum(tot.total_app)}</td>
      <td class="px-3 py-2 text-sm text-right text-slate-600">${fmtNum(tot.total_pv)}</td>
      <td class="px-3 py-2 text-sm text-right text-emerald-700">${totConv}%</td>
      <td class="px-3 py-2 text-xs text-slate-600 text-right">${tot.total_jobs}</td>
    </tr>
  `;
  document.getElementById('jb-dept-table').innerHTML = `
    <table class="min-w-full text-sm">
      <thead class="bg-slate-50 sticky top-0">
        <tr>
          ${th('dept', '部門', 'text-left')}
          ${th('app_104', '104 履歷', 'text-right')}
          ${th('pv_104', '104 瀏覽', 'text-right')}
          ${th('app_1111', '1111 履歷', 'text-right')}
          ${th('pv_1111', '1111 瀏覽', 'text-right')}
          ${th('total_app', '合計履歷', 'text-right')}
          ${th('total_pv', '合計瀏覽', 'text-right')}
          ${th('conv', '合計轉換', 'text-right')}
          ${th('total_jobs', '職務', 'text-right')}
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="9" class="p-4 text-center text-slate-400">無資料</td></tr>'}${merged.length ? totRow : ''}</tbody>
    </table>
  `;
}

function sortJbDept(key) {
  if (JB_DEPT_SORT.key === key) JB_DEPT_SORT.desc = !JB_DEPT_SORT.desc;
  else JB_DEPT_SORT = { key, desc: true };
  const src = FILTERED || DATA;
  const re = src.recruitment_effectiveness || {};
  renderJbDeptTable(re.weekly_104, re.weekly_1111);
}

function renderJbTopJobs(elId, data, color) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!data) { el.innerHTML = emptyState('無資料'); return; }
  const rows = (data.top_jobs_by_app || []).map((j, i) => `
    <tr class="border-b border-slate-100 hover:bg-slate-50">
      <td class="px-2 py-2 text-xs text-slate-400 text-right">${i + 1}</td>
      <td class="px-3 py-2 text-xs" title="${j.title}">${j.title.length > 30 ? j.title.slice(0, 30) + '…' : j.title}</td>
      <td class="px-3 py-2 text-xs text-slate-500">${j.dept}</td>
      <td class="px-3 py-2 text-xs text-right font-semibold text-${color}-700">${fmtNum(j.total_app)}</td>
      <td class="px-3 py-2 text-xs text-right text-slate-400">${fmtNum(j.total_pv)}</td>
      <td class="px-3 py-2 text-xs text-right text-amber-700">${j.conversion_rate}%</td>
    </tr>
  `).join('');
  el.innerHTML = `
    <table class="w-full text-sm">
      <thead class="bg-slate-50 sticky top-0">
        <tr>
          <th class="px-2 py-2 text-right text-xs font-medium text-slate-600">#</th>
          <th class="px-3 py-2 text-left text-xs font-medium text-slate-600">職務</th>
          <th class="px-3 py-2 text-left text-xs font-medium text-slate-600">部門</th>
          <th class="px-3 py-2 text-right text-xs font-medium text-slate-600">履歷</th>
          <th class="px-3 py-2 text-right text-xs font-medium text-slate-600">瀏覽</th>
          <th class="px-3 py-2 text-right text-xs font-medium text-slate-600">轉換</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="6" class="p-4 text-center text-slate-400">無資料</td></tr>'}</tbody>
    </table>
  `;
}

function renderJbUnmatched(d104, d1111) {
  const rows = [];
  (d104?.unmatched_jobs || []).forEach(u => rows.push({ ...u, src: '104', loc: u.dept_raw }));
  (d1111?.unmatched_jobs || []).forEach(u => rows.push({ ...u, src: '1111', loc: u.location }));
  document.getElementById('jb-unmatched-count').textContent = rows.length ? `(${rows.length} 個)` : '(全部已分類 ✓)';
  if (!rows.length) {
    document.getElementById('jb-unmatched-table').innerHTML = '<p class="text-sm text-emerald-600 px-2 py-2">✅ 兩平台所有職缺都已對應到 hr-dashboard 部門</p>';
    return;
  }
  const body = rows.map(u => `
    <tr class="border-b border-amber-200 hover:bg-amber-50">
      <td class="px-3 py-2 text-xs"><span class="px-1.5 py-0.5 rounded ${u.src === '104' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}">${u.src}</span></td>
      <td class="px-3 py-2 text-sm" title="${u.title}">${u.title}</td>
      <td class="px-3 py-2 text-xs text-slate-500">${u.loc || '(無)'}</td>
      <td class="px-3 py-2 text-sm text-right">${fmtNum(u.total_app)}</td>
      <td class="px-3 py-2 text-sm text-right">${fmtNum(u.total_pv)}</td>
    </tr>
  `).join('');
  document.getElementById('jb-unmatched-table').innerHTML = `
    <table class="w-full text-sm">
      <thead class="bg-amber-100">
        <tr>
          <th class="px-3 py-2 text-left text-xs font-medium text-amber-900">來源</th>
          <th class="px-3 py-2 text-left text-xs font-medium text-amber-900">職缺名稱</th>
          <th class="px-3 py-2 text-left text-xs font-medium text-amber-900">地區/原 dept</th>
          <th class="px-3 py-2 text-right text-xs font-medium text-amber-900">履歷</th>
          <th class="px-3 py-2 text-right text-xs font-medium text-amber-900">瀏覽</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function renderJbLowConv(d104, d1111) {
  const rows = [];
  (d104?.low_conversion_jobs || []).forEach(j => rows.push({ ...j, src: '104' }));
  (d1111?.low_conversion_jobs || []).forEach(j => rows.push({ ...j, src: '1111' }));
  rows.sort((a, b) => a.conversion_rate - b.conversion_rate);
  if (!rows.length) {
    document.getElementById('jb-lowconv-table').innerHTML = '<p class="text-sm text-slate-500 px-2 py-2">無低轉換職務</p>';
    return;
  }
  const body = rows.map(j => `
    <tr class="border-b border-slate-100 hover:bg-amber-50">
      <td class="px-3 py-2 text-xs"><span class="px-1.5 py-0.5 rounded ${j.src === '104' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}">${j.src}</span></td>
      <td class="px-3 py-2 text-sm" title="${j.title}">${j.title.length > 45 ? j.title.slice(0, 45) + '…' : j.title}</td>
      <td class="px-3 py-2 text-xs text-slate-500">${j.dept}</td>
      <td class="px-3 py-2 text-sm text-right text-slate-500">${fmtNum(j.total_pv)}</td>
      <td class="px-3 py-2 text-sm text-right text-amber-700">${fmtNum(j.total_app)}</td>
      <td class="px-3 py-2 text-sm text-right font-semibold text-red-600">${j.conversion_rate}%</td>
    </tr>
  `).join('');
  document.getElementById('jb-lowconv-table').innerHTML = `
    <table class="w-full text-sm">
      <thead class="bg-slate-50">
        <tr>
          <th class="px-3 py-2 text-left text-xs font-medium text-slate-600">來源</th>
          <th class="px-3 py-2 text-left text-xs font-medium text-slate-600">職務</th>
          <th class="px-3 py-2 text-left text-xs font-medium text-slate-600">部門</th>
          <th class="px-3 py-2 text-right text-xs font-medium text-slate-600">瀏覽</th>
          <th class="px-3 py-2 text-right text-xs font-medium text-slate-600">履歷</th>
          <th class="px-3 py-2 text-right text-xs font-medium text-slate-600">轉換</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function renderMeta() {
  const meta = DATA.meta;
  const gen = new Date(meta.generated_at);
  const ageDays = Math.floor((Date.now() - gen.getTime()) / (1000 * 60 * 60 * 24));
  // 新鮮度: <=7天 綠 / 8-30 黃 / >30 紅
  let freshness, badgeClass, badgeIcon;
  if (ageDays <= 7) {
    freshness = `更新於 ${ageDays === 0 ? '今天' : ageDays + ' 天前'}`;
    badgeClass = 'bg-emerald-100 text-emerald-700 border border-emerald-200';
    badgeIcon = '✓';
  } else if (ageDays <= 30) {
    freshness = `更新於 ${ageDays} 天前 (建議刷新)`;
    badgeClass = 'bg-amber-100 text-amber-700 border border-amber-200';
    badgeIcon = '⚠';
  } else {
    freshness = `已 ${ageDays} 天未更新 (請立即下載 HRM 清單)`;
    badgeClass = 'bg-red-100 text-red-700 border border-red-200 animate-pulse';
    badgeIcon = '⚠';
  }
  document.getElementById('meta-info').innerHTML = `
    <span class="inline-flex items-center gap-2">
      <span>資料期間 ${meta.data_period}</span>
      <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badgeClass}">${badgeIcon} ${freshness}</span>
      <span class="text-slate-400 text-xs">| 來源: ${meta.source_active} / ${meta.source_resign}</span>
    </span>
  `;
  document.getElementById('footer-time').textContent = gen.toLocaleString('zh-TW');
}

function renderKPI() {
  const k = FILTERED.kpi;
  const prefix = k.period_label || '今年至今';
  const months = new Date().getMonth() + 1;
  const annualized = prefix === '今年至今' && k.ytd_turnover_rate
    ? (k.ytd_turnover_rate * 12 / months).toFixed(1) + '%' : '-';

  // vs 上月趨勢 (只有區間 = 單月時才算)
  const trends = computeMonthOverMonthTrends();

  const cards = [
    { label: '目前在職', value: fmtNum(k.current_active), sub: '人' },
    { label: `${prefix} 離職`, value: fmtNum(k.ytd_resignations), sub: '人', color: 'text-red-600', trend: trends.resign, inverse: true },
    { label: `${prefix} 到職`, value: fmtNum(k.ytd_new_hires), sub: '人', color: 'text-emerald-600', trend: trends.newHire },
    { label: `${prefix} 流失率`, value: (k.ytd_turnover_rate ?? '-') + '%', sub: prefix === '今年至今' ? `年化 ${annualized}` : '期末在職為分母', color: k.ytd_turnover_rate > 20 ? 'text-red-600' : 'text-slate-900', trend: trends.turnover, inverse: true },
    { label: '遞補完成率', value: (k.ytd_backfill_completion ?? '-') + '%', sub: '遞補錄取/離職', color: k.ytd_backfill_completion < 50 ? 'text-amber-600' : 'text-emerald-600' },
    { label: `${prefix} 短期離職`, value: fmtNum(k.ytd_short_term_resign), sub: '在職天數 < 90 天', color: 'text-red-600', trend: trends.shortTerm, inverse: true },
  ];
  const html = cards.map(c => `
    <div class="kpi-card">
      <div class="kpi-label">${c.label}</div>
      <div class="flex items-baseline gap-2">
        <div class="kpi-value ${c.color || ''}">${c.value}</div>
        ${renderTrendBadge(c.trend, c.inverse)}
      </div>
      <div class="kpi-sub">${c.sub || ''}</div>
    </div>
  `).join('');
  document.getElementById('kpi-cards').innerHTML = html;
}

// 計算 vs 上月變化 (只在區間 = 單月時計算)
function computeMonthOverMonthTrends() {
  const from = document.getElementById('filter-month-from').value;
  const to = document.getElementById('filter-month-to').value;
  const empty = { resign: null, newHire: null, turnover: null, shortTerm: null };
  if (!from || from !== to) return empty;  // 只支援單月

  // 取上月
  const [y, m] = from.split('-').map(Number);
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;
  const prev = `${prevY}-${String(prevM).padStart(2, '0')}`;

  // 上月資料只能從 DATA.monthly_trend 拿
  const prevData = DATA.monthly_trend.find(x => x.month === prev);
  if (!prevData) return empty;

  // 篩選後當月的離職/到職 (用 FILTERED.resignation_list)
  const dept = document.getElementById('filter-dept').value;
  const title = document.getElementById('filter-title').value;
  const matchDept = r => !dept || r.dept === dept;
  const matchTitle = r => !title || r.title === title;

  // 當月已經是 FILTERED 內的全部 (因為 filter = 單月)
  const curResign = FILTERED.kpi.ytd_resignations;
  const curNewHire = FILTERED.kpi.ytd_new_hires;
  const curShortTerm = FILTERED.kpi.ytd_short_term_resign;

  // 上月: 從原始 DATA 篩選同部門/職務 + 上月日期
  const prevResign = DATA.resignation_list.filter(r =>
    matchDept(r) && matchTitle(r) && (r.leave || '').slice(0, 7) === prev
  ).length;
  const prevNewHire = DATA.new_hire_list.filter(r =>
    matchDept(r) && matchTitle(r) && (r.start || '').slice(0, 7) === prev
  ).length;
  const prevShortTerm = DATA.short_term_resignations.filter(r =>
    matchDept(r) && matchTitle(r) && ((r.leave || '').slice(0, 7) === prev || (r.start || '').slice(0, 7) === prev)
  ).length;

  return {
    resign: { cur: curResign, prev: prevResign },
    newHire: { cur: curNewHire, prev: prevNewHire },
    turnover: { cur: FILTERED.kpi.ytd_turnover_rate, prev: prevData.turnover_rate ?? null, suffix: '%' },
    shortTerm: { cur: curShortTerm, prev: prevShortTerm },
  };
}

function renderTrendBadge(trend, inverse = false) {
  if (!trend || trend.prev == null) return '';
  const diff = trend.cur - trend.prev;
  if (diff === 0) return '<span class="text-xs text-slate-400">→</span>';
  const up = diff > 0;
  // inverse=true 表示「越低越好」(離職/流失率等),所以 up=壞
  const isGood = inverse ? !up : up;
  const color = isGood ? 'text-emerald-600' : 'text-red-600';
  const arrow = up ? '↑' : '↓';
  const sign = up ? '+' : '';
  return `<span class="text-xs font-medium ${color}" title="vs 上月">${arrow}${sign}${diff.toFixed(diff % 1 === 0 ? 0 : 1)}${trend.suffix || ''}</span>`;
}

function fmtNum(n) {
  if (n == null || n === '-') return n;
  if (typeof n !== 'number') return n;
  return n.toLocaleString('zh-TW');
}

function destroyChart(id) {
  if (CHARTS[id]) { CHARTS[id].destroy(); CHARTS[id] = null; }
}

function renderMonthlyChart() {
  destroyChart('monthly');
  const data = FILTERED.monthly_trend;
  const ctx = document.getElementById('chart-monthly');
  CHARTS.monthly = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(m => m.month),
      datasets: [
        { label: '離職', data: data.map(m => m.resignations), backgroundColor: '#ef4444' },
        { label: '到職', data: data.map(m => m.new_hires), backgroundColor: '#10b981' },
        {
          label: '淨增減', type: 'line',
          data: data.map(m => m.net), borderColor: '#3b82f6',
          backgroundColor: '#3b82f6', tension: 0.3, yAxisID: 'y'
        },
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom' } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

function renderReasonsChart() {
  destroyChart('reasons');
  const data = FILTERED.resignation_reasons;
  const ctx = document.getElementById('chart-reasons');
  // 排序：由多到少，方便閱讀
  const sorted = [...data].sort((a, b) => b.count - a.count);
  CHARTS.reasons = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(r => r.reason),
      datasets: [{
        label: '人數',
        data: sorted.map(r => r.count),
        backgroundColor: '#ef4444',
        borderRadius: 4,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.x} 人` } }
      },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0 } },
        y: { ticks: { font: { size: 11 } } }
      }
    }
  });
}

function renderTenureChart() {
  destroyChart('tenure');
  const data = FILTERED.tenure_distribution;
  const ctx = document.getElementById('chart-tenure');
  CHARTS.tenure = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.bucket),
      datasets: [{
        label: '離職人數', data: data.map(d => d.count),
        backgroundColor: ['#ef4444', '#f59e0b', '#f59e0b', '#fbbf24', '#84cc16', '#22c55e', '#10b981', '#0891b2']
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: { legend: { display: false } }
    }
  });
}

function renderShortTermChart() {
  // 延後到下一幀，確保父元素已 layout，避免 Chart.js 取到 0×0
  requestAnimationFrame(() => _drawShortTermChart());
}

function _drawShortTermChart() {
  destroyChart('shorttermDept');
  const ctx = document.getElementById('chart-shortterm-dept');
  if (!ctx) return;
  // 清掉先前的「無資料」覆蓋層
  const emptyEl = ctx.parentElement.querySelector('.chart-empty-overlay');
  if (emptyEl) emptyEl.remove();
  ctx.style.display = '';
  const data = (FILTERED && FILTERED.short_term_resignations) || [];
  // 依部門彙總：人數 + 平均在職天數
  const grp = {};
  for (const r of data) {
    const d = r.dept || '(未填)';
    if (!grp[d]) grp[d] = { count: 0, totalDays: 0 };
    grp[d].count += 1;
    grp[d].totalDays += (r.tenure_days || 0);
  }
  const sorted = Object.entries(grp)
    .map(([d, v]) => ({ dept: d, count: v.count, avgDays: v.count ? Math.round(v.totalDays / v.count) : 0 }))
    .sort((a, b) => b.count - a.count);
  if (sorted.length === 0) {
    // 不要破壞 canvas — 改用覆蓋層
    ctx.style.display = 'none';
    const p = document.createElement('p');
    p.className = 'chart-empty-overlay text-slate-400 text-sm text-center py-12';
    p.textContent = '目前篩選範圍無短期離職資料';
    ctx.parentElement.appendChild(p);
    return;
  }
  const labels = sorted.map(x => x.dept);
  CHARTS.shorttermDept = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '離職人數',
          data: sorted.map(x => x.count),
          backgroundColor: '#ef4444',
          borderRadius: 4,
          yAxisID: 'y',
        },
        {
          label: '平均在職天數',
          data: sorted.map(x => x.avgDays),
          backgroundColor: '#f59e0b',
          borderRadius: 4,
          yAxisID: 'y1',
        },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (c) => c.dataset.label === '離職人數'
              ? `離職人數: ${c.parsed.y} 人`
              : `平均在職: ${c.parsed.y} 天`
          }
        }
      },
      scales: {
        x: { ticks: { font: { size: 10 }, maxRotation: 45, minRotation: 30 } },
        y: {
          beginAtZero: true,
          position: 'left',
          title: { display: true, text: '人數', font: { size: 10 } },
          ticks: { precision: 0, color: '#ef4444' },
        },
        y1: {
          beginAtZero: true,
          position: 'right',
          title: { display: true, text: '天數', font: { size: 10 } },
          ticks: { precision: 0, color: '#f59e0b' },
          grid: { drawOnChartArea: false },
        },
      }
    }
  });
}

function renderShortTermTable() {
  // 動態填入「離職月份」下拉（依目前 FILTERED 範圍）
  const monthSel = document.getElementById('filter-shortterm-month');
  const all = FILTERED.short_term_resignations;
  const months = [...new Set(all.map(r => (r.leave || '').slice(0, 7)).filter(Boolean))].sort();
  const cur = monthSel.value;
  monthSel.innerHTML = '<option value="">全部</option>' +
    months.map(m => `<option value="${m}"${m === cur ? ' selected' : ''}>${m}</option>`).join('');
  const data = cur ? all.filter(r => (r.leave || '').startsWith(cur)) : all;
  if (data.length === 0) {
    document.getElementById('short-term-table').innerHTML = '<p class="text-slate-400 text-sm py-8 text-center">無短期離職人員</p>';
    return;
  }
  // 個人因素/個人問題 視為「不需特別顯示」，其他原因才顯示在離職原因欄
  const showReason = (reason) => {
    if (!reason) return '';
    if (reason.includes('個人')) return '';
    return reason;
  };
  const html = `
    <table class="data-table">
      <thead>
        <tr><th>工號</th><th>姓名</th><th>部門</th><th>職務</th><th>到職</th><th>離職</th><th class="text-right">在職天數</th><th>離職原因</th></tr>
      </thead>
      <tbody>
        ${data.map(r => `
          <tr>
            <td class="font-mono text-xs">${r.id || '-'}</td>
            <td class="font-medium">${r.name}</td>
            <td>${r.dept}</td>
            <td class="text-slate-600">${r.title}</td>
            <td class="text-slate-500 text-xs">${r.start || '-'}</td>
            <td class="text-slate-500 text-xs">${r.leave || '-'}</td>
            <td class="text-right"><span class="badge ${r.tenure_days < 7 ? 'badge-resigned' : r.tenure_days < 30 ? 'badge-backfill' : 'badge-pending'}">${r.tenure_days ?? '-'} 天</span></td>
            <td class="text-xs text-red-600 font-medium">${showReason(r.reason)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  document.getElementById('short-term-table').innerHTML = html;
}

function renderLeaveTracking() {
  const wrap = document.getElementById('leave-tracking-table');
  if (!wrap) return;
  let data = DATA.leave_tracking || [];
  // 套用部門篩選
  const deptFilter = document.getElementById('filter-dept')?.value || '';
  if (deptFilter) data = data.filter(r => r.dept === deptFilter);
  if (data.length === 0) {
    wrap.innerHTML = `<div class="text-center text-sm text-slate-400 py-6">${deptFilter ? `「${deptFilter}」目前無` : '本期間無'}留停/異動人員</div>`;
    return;
  }
  const statusClass = (s, cat) => {
    if (cat === '異動單位') return 'text-slate-500';
    if (s && s.startsWith('已逾期')) return 'text-red-600 font-bold';
    if (s && s.startsWith('即將復職')) return 'text-amber-600 font-semibold';
    return 'text-blue-600';
  };
  const catBadge = (c) => c === '留職停薪'
    ? '<span class="badge bg-violet-100 text-violet-800">留職停薪</span>'
    : '<span class="badge bg-slate-100 text-slate-700">異動單位</span>';
  wrap.innerHTML = `
    <table class="data-table text-xs">
      <thead>
        <tr>
          <th>工號</th><th>姓名</th><th>部門</th><th>職務</th>
          <th>類型</th><th>生效日</th><th>應復職日</th><th>狀態</th><th>備註</th>
        </tr>
      </thead>
      <tbody>
        ${data.map(r => `
          <tr>
            <td class="font-mono">${r.id}</td>
            <td class="font-medium">${r.name}</td>
            <td>${r.dept}</td>
            <td>${r.title}</td>
            <td>${catBadge(r.category)}</td>
            <td>${r.effective_date || '-'}</td>
            <td>${r.return_date || '-'}</td>
            <td class="${statusClass(r.status, r.category)}">${r.status}</td>
            <td class="text-slate-500 text-[11px]">${r.remark || ''}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderYoYCompare() {
  const section = document.getElementById('section-yoy');
  if (!section) return;
  const yoy = (DATA.yoy && DATA.yoy.yearly) || [];
  if (yoy.length === 0) { section.style.display = 'none'; return; }
  section.style.display = '';

  // 三種切片：dept / 月份區間 / 全公司全年
  const deptFilter = document.getElementById('filter-dept')?.value || '';
  const monthFrom = document.getElementById('filter-month-from')?.value || '';
  const monthTo = document.getElementById('filter-month-to')?.value || '';
  const ydm = DATA.yoy.year_dept_month || {};
  const ymc = DATA.yoy.year_month_counts || {};

  // 解析篩選區間月份
  const fromM = monthFrom ? parseInt(monthFrom.slice(5, 7)) : 1;
  const toM = monthTo ? parseInt(monthTo.slice(5, 7)) : 12;
  const yearNow = DATA.meta.year;
  const todayMonth = new Date().getFullYear() === yearNow ? new Date().getMonth() + 1 : 12;
  const isFullPeriod = (fromM === 1 && toM === todayMonth);

  // 月份篩選 helper：對某年某月集合做累加
  const sumMonths = (monthMap, fromM_, toM_) => {
    let s = 0;
    for (let m = fromM_; m <= toM_; m++) {
      const v = monthMap[m] != null ? monthMap[m] : monthMap[String(m)];
      if (v != null) s += v;
    }
    return s;
  };

  let labels, ratesActual, ratesAnnual, counts;
  let isDeptView = !!deptFilter;
  const titleEl = section.querySelector('h2');
  if (titleEl && !titleEl.dataset.origText) titleEl.dataset.origText = titleEl.textContent.trim();
  let subtitle = '';
  if (deptFilter) subtitle += ` — ${deptFilter}`;
  if (!isFullPeriod) subtitle += `（${fromM}-${toM}月同期）`;
  if (titleEl) titleEl.innerHTML = `<span class="text-blue-600">📊</span> 年度離職率對比<span class="text-base text-blue-600">${subtitle}</span>`;

  // 計算各年「該區間」內的離職數
  counts = yoy.map(y => {
    const yKey = String(y.year);
    let monthMap;
    if (deptFilter) {
      monthMap = (ydm[yKey] || {})[deptFilter] || {};
    } else {
      monthMap = ymc[yKey] || {};
    }
    return sumMonths(monthMap, fromM, toM);
  });

  // 流失率：只有「全公司 + 全年」才用 DATA.yoy 預算的（已含期初/期末）；
  // 部門級或月份切片，目前未提供期初/期末，無法精算流失率
  if (!deptFilter && isFullPeriod) {
    ratesActual = yoy.map(y => y.turnover_rate);
    ratesAnnual = yoy.map(y => y.turnover_rate_annualized);
  } else {
    ratesActual = yoy.map(() => null);
    ratesAnnual = yoy.map(() => null);
  }

  labels = yoy.map(y => y.is_full_year ? `${y.year}` : `${y.year} (${y.coverage_months}月)`);

  destroyChart('yoyTrend');
  const ctx = document.getElementById('chart-yoy-trend');
  CHARTS.yoyTrend = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        {
          type: 'bar', label: '離職人數 (實際)', data: counts, yAxisID: 'y1',
          backgroundColor: yoy.map(y => y.is_full_year ? '#94a3b8' : '#fbbf24'),
          borderRadius: 4, order: 3,
        },
        {
          type: 'line', label: '流失率 % (實際)', data: ratesActual, yAxisID: 'y2',
          borderColor: '#3b82f6', backgroundColor: '#3b82f6',
          tension: 0.3, borderWidth: 2, pointRadius: 4,
          borderDash: [4, 4], order: 2,
        },
        {
          type: 'line', label: '流失率 % (年化推估)', data: ratesAnnual, yAxisID: 'y2',
          borderColor: '#ef4444', backgroundColor: '#fecaca',
          tension: 0.3, borderWidth: 3, pointRadius: 5, order: 1,
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { afterBody: (items) => {
          const i = items[0].dataIndex;
          const y = yoy[i];
          if (y.is_full_year) return '✓ 全年資料';
          return `⚠ 僅 ${y.coverage_months} 月資料\n年化推估離職: ${y.annualized_resignations} 人`;
        }}}
      },
      scales: {
        y1: { position: 'left', beginAtZero: true, title: { display: true, text: '離職人數' } },
        y2: { position: 'right', beginAtZero: true, title: { display: true, text: '流失率 %' }, grid: { display: false } },
      }
    }
  });

  // 月度離職潮對比圖（4 年同月份比較）
  // 部門篩選時用 dept 切片
  let mc = DATA.yoy.year_month_counts || {};
  if (deptFilter) {
    mc = {};
    Object.keys(ydm).forEach(y => {
      if (ydm[y][deptFilter]) mc[y] = ydm[y][deptFilter];
    });
  }
  const monthLabels = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  const yearColors = {
    '2023': { border: '#94a3b8', bg: 'rgba(148,163,184,0.1)' },
    '2024': { border: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
    '2025': { border: '#10b981', bg: 'rgba(16,185,129,0.1)' },
    '2026': { border: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
  };
  const currentYear = DATA.meta.year;
  const datasets = Object.keys(mc).sort().map(y => {
    const vals = mc[y];
    const yNum = parseInt(y);
    // 計算該年「最大有資料月份」(用於 YTD：之後填 null 不畫線)
    const monthsWithData = Object.keys(vals).map(k => parseInt(k)).filter(n => !isNaN(n));
    const maxMonth = monthsWithData.length ? Math.max(...monthsWithData) : 0;
    const data = Array.from({length: 12}, (_, i) => {
      const m = i + 1;
      const v = vals[m] != null ? vals[m] : (vals[String(m)] != null ? vals[String(m)] : null);
      if (v != null) return v;
      // 缺值處理：過去年度全填 0；當年度只填到 maxMonth 為止，之後 null
      if (yNum < currentYear) return 0;
      if (yNum === currentYear && m <= maxMonth) return 0;
      return null;
    });
    const isCurrent = y === String(DATA.meta.year);
    return {
      label: y,
      data,
      borderColor: (yearColors[y] || {}).border || '#64748b',
      backgroundColor: (yearColors[y] || {}).bg || 'rgba(100,116,139,0.1)',
      borderWidth: isCurrent ? 3 : 2,
      tension: 0.3,
      pointRadius: isCurrent ? 5 : 3,
      pointHoverRadius: 7,
      spanGaps: false,
    };
  });
  // 自動推導每年解讀（全公司視角；部門視角下不顯示固定文字）
  const INTERPRET = deptFilter ? {} : {
    '2023': '年後跳槽潮',
    '2024': '集中 Q2',
    '2025': '暑假後離職潮',
    '2026': '今年至今持續高位無低谷',
  };
  const insightsHtml = Object.keys(mc).sort().map(y => {
    const vals = mc[y];
    const allMonths = Array.from({length: 12}, (_, i) => {
      const m = i + 1;
      const v = vals[m] != null ? vals[m] : (vals[String(m)] != null ? vals[String(m)] : 0);
      return { month: m, count: v };
    });
    // 找出 Top 2 高峰月 (count > 0)
    const sorted = allMonths.filter(x => x.count > 0).sort((a, b) => b.count - a.count);
    const peaks = sorted.slice(0, 2);
    const totalMonths = allMonths.filter(x => x.count > 0).length;
    const total = allMonths.reduce((s, x) => s + x.count, 0);
    const avg = totalMonths ? (total / totalMonths).toFixed(1) : '-';
    const color = (yearColors[y] || {}).border || '#64748b';
    const bg = (yearColors[y] || {}).bg || 'rgba(100,116,139,0.1)';
    const isCurrent = y === String(DATA.meta.year);
    return `
      <div class="rounded-lg p-3 border-2" style="border-color:${color}; background:${bg};">
        <div class="flex items-baseline justify-between mb-1">
          <div class="font-bold text-sm" style="color:${color};">${y}${isCurrent ? '（今年至今）' : ''}</div>
          <div class="text-[10px] text-slate-500">月均 ${avg} 人</div>
        </div>
        <div class="text-[11px] text-slate-600 mb-1">
          <span class="font-medium">高峰：</span>
          ${peaks.map(p => `<span class="inline-block">${p.month}月 (${p.count})</span>`).join('、')}
        </div>
        <div class="text-[11px] font-medium" style="color:${color};">
          ${INTERPRET[y] || ''}
        </div>
      </div>
    `;
  }).join('');
  document.getElementById('yoy-monthly-insights').innerHTML = insightsHtml;

  destroyChart('yoyMonthly');
  CHARTS.yoyMonthly = new Chart(document.getElementById('chart-yoy-monthly'), {
    type: 'line',
    data: { labels: monthLabels, datasets },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 14, font: { size: 12 } } },
        tooltip: { callbacks: { title: (items) => items[0].label } },
      },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: '離職人數' } },
        x: { title: { display: false } }
      }
    }
  });

  // 部門檢視時，3 方法流失率無意義（缺部門期初/期末）→ 只顯示離職數對比
  // 切片視角（部門 或 月份區間）：只顯示離職數對比，不算流失率
  if (isDeptView || !isFullPeriod) {
    const desc = [];
    if (deptFilter) desc.push(`<b>${deptFilter}</b>`);
    if (!isFullPeriod) desc.push(`${fromM}-${toM}月同期`);
    document.getElementById('yoy-table').innerHTML = `
      <div class="text-xs text-slate-500 mb-2">${desc.join(' × ')} 各年度離職數</div>
      <table class="data-table text-xs">
        <thead><tr><th>年度</th><th class="text-right">離職</th><th class="text-right">變化</th></tr></thead>
        <tbody>
          ${yoy.map((y, i) => {
            const cnt = counts[i];
            const prevCnt = i > 0 ? counts[i-1] : null;
            let delta = '-';
            if (prevCnt != null && cnt != null) {
              const d = cnt - prevCnt;
              const cls = d > 0 ? 'text-red-600' : d < 0 ? 'text-emerald-600' : 'text-slate-500';
              const arrow = d > 0 ? '↑' : d < 0 ? '↓' : '→';
              delta = `<span class="${cls}">${arrow} ${d > 0 ? '+' : ''}${d}</span>`;
            }
            return `
              <tr ${y.is_ytd ? 'class="bg-amber-50"' : ''}>
                <td class="font-medium">${y.year}</td>
                <td class="text-right font-semibold">${cnt}</td>
                <td class="text-right">${delta}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
      <p class="text-[10px] text-slate-500 mt-2 leading-tight">
        切片視角無法計算流失率（缺對應期間的期初/期末在職）；顯示離職人數絕對值對比。
      </p>
    `;
    return;
  }

  // 流失率表格（只顯示平均人數法 — 業界標準）
  document.getElementById('yoy-table').innerHTML = `
    <table class="data-table text-xs">
      <thead>
        <tr>
          <th>年度</th>
          <th class="text-right">離職</th>
          <th class="text-right">流失率</th>
          <th class="text-right">年增減</th>
        </tr>
      </thead>
      <tbody>
        ${yoy.map((y, i) => {
          const covBadge = y.is_full_year
            ? '<span class="text-[10px] text-emerald-600">全年</span>'
            : `<span class="text-[10px] text-amber-600">${y.coverage_months}月→年化</span>`;
          const prev = i > 0 ? yoy[i-1] : null;
          let yoyDelta = '-';
          if (prev && prev.turnover_rate_annualized != null && y.turnover_rate_annualized != null) {
            const dd = y.turnover_rate_annualized - prev.turnover_rate_annualized;
            const cls = dd > 0 ? 'text-red-600 font-semibold' : dd < 0 ? 'text-emerald-600' : 'text-slate-500';
            const arrow = dd > 0 ? '↑' : dd < 0 ? '↓' : '→';
            yoyDelta = `<span class="${cls}">${arrow} ${dd > 0 ? '+' : ''}${dd.toFixed(1)}%</span>`;
          }
          return `
            <tr ${y.is_ytd ? 'class="bg-amber-50"' : ''}>
              <td>
                <div class="font-medium">${y.year}</div>
                <div>${covBadge}</div>
              </td>
              <td class="text-right">
                <div>${y.resignations}</div>
                ${!y.is_full_year ? `<div class="text-[10px] text-amber-700">年化 ${y.annualized_resignations}</div>` : ''}
              </td>
              <td class="text-right font-semibold">${y.turnover_rate_annualized ?? '-'}%</td>
              <td class="text-right">${yoyDelta}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
    <p class="text-[10px] text-slate-500 mt-2 leading-tight">
      <b>流失率</b> = 當年離職 ÷ (期初在職 + 期末在職) ÷ 2 × 100%（業界標準：SHRM / 勞動部 / ISO 30414）<br>
      不滿 12 個月者已年化（× 12 ÷ 已過月份）。<br>
      ${DATA.yoy.note || ''}
    </p>
  `;
}

function renderHighTurnoverFocus() {
  const section = document.getElementById('section-high-turnover');
  const wrap = document.getElementById('high-turnover-cards');
  if (!section || !wrap) return;

  // 已選特定部門時隱藏（避免在單一部門下又看到聚焦卡）
  const deptFilter = document.getElementById('filter-dept')?.value || '';
  if (deptFilter) { section.style.display = 'none'; return; }
  section.style.display = '';

  // 篩選候選：流失率 ≥ 30% + 離職 ≥ 3 人 + (在職+離職) ≥ 10 人
  // (排除小單位 2 人離職 → 50%+ 的統計噪音)
  const candidates = (FILTERED.departments || [])
    .filter(d => d.turnover_rate >= 30 && d.resignations >= 3 && (d.current + d.resignations) >= 10)
    .sort((a, b) => b.turnover_rate - a.turnover_rate)
    .slice(0, 3);

  if (candidates.length === 0) {
    wrap.innerHTML = `<div class="col-span-full text-center text-sm text-slate-400 py-8">目前無流失率 ≥ 30% 且樣本充足的部門</div>`;
    return;
  }

  const resigns = FILTERED.resignation_list || [];

  wrap.innerHTML = candidates.map(d => {
    const deptResigns = resigns.filter(r => r.dept === d.name);
    // Top 3 職務
    const titleCount = {};
    deptResigns.forEach(r => { const t = r.title || '未填'; titleCount[t] = (titleCount[t] || 0) + 1; });
    const topTitles = Object.entries(titleCount).sort((a, b) => b[1] - a[1]).slice(0, 3);
    // Top 3 原因
    const reasonCount = {};
    deptResigns.forEach(r => { const k = r.reason || '未填'; reasonCount[k] = (reasonCount[k] || 0) + 1; });
    const topReasons = Object.entries(reasonCount).sort((a, b) => b[1] - a[1]).slice(0, 3);
    // 平均年資
    const tenures = deptResigns.map(r => r.tenure_days).filter(t => t != null);
    const avgTenure = tenures.length ? Math.round(tenures.reduce((s, t) => s + t, 0) / tenures.length) : null;
    const avgTenureLabel = avgTenure == null ? '-' : (avgTenure < 90 ? `${avgTenure} 天` : avgTenure < 365 ? `${(avgTenure/30).toFixed(1)} 個月` : `${(avgTenure/365).toFixed(1)} 年`);
    // 短期離職占比
    const shortCount = deptResigns.filter(r => r.tenure_days != null && r.tenure_days < 90).length;
    const shortPct = deptResigns.length ? Math.round(shortCount / deptResigns.length * 100) : 0;

    const rateColor = d.turnover_rate >= 60 ? 'text-red-600 bg-red-50 border-red-200'
                    : d.turnover_rate >= 40 ? 'text-orange-600 bg-orange-50 border-orange-200'
                    : 'text-amber-600 bg-amber-50 border-amber-200';

    return `
      <div class="border ${rateColor} rounded-lg p-4 cursor-pointer hover:shadow-md transition-shadow" onclick="drillByDept('${escapeAttr(d.name)}')">
        <div class="flex items-baseline justify-between mb-3">
          <div class="font-semibold text-slate-800 truncate" title="${escapeAttr(d.name)}">${d.name}</div>
          <div class="text-2xl font-bold ${rateColor.split(' ')[0]}">${d.turnover_rate}%</div>
        </div>
        <div class="grid grid-cols-3 gap-2 text-xs mb-3 text-center">
          <div><div class="text-slate-400">在職</div><div class="font-semibold text-slate-700">${d.current}</div></div>
          <div><div class="text-slate-400">離職</div><div class="font-semibold text-red-600">${d.resignations}</div></div>
          <div><div class="text-slate-400">到職</div><div class="font-semibold text-emerald-600">${d.new_hires}</div></div>
        </div>
        <div class="grid grid-cols-2 gap-2 text-[11px] mb-3">
          <div class="bg-white/60 rounded px-2 py-1"><span class="text-slate-500">平均年資</span> <span class="font-semibold">${avgTenureLabel}</span></div>
          <div class="bg-white/60 rounded px-2 py-1"><span class="text-slate-500">短期離職</span> <span class="font-semibold text-red-600">${shortCount}</span><span class="text-slate-400"> (${shortPct}%)</span></div>
        </div>
        <div class="mb-2">
          <div class="text-[11px] text-slate-500 mb-1">離職職務 Top 3</div>
          ${topTitles.length === 0 ? '<div class="text-xs text-slate-400">—</div>' :
            topTitles.map(([t, c]) => `<div class="flex justify-between text-xs"><span class="text-slate-700 truncate mr-2">${t}</span><span class="font-semibold text-slate-600">${c}</span></div>`).join('')}
        </div>
        <div>
          <div class="text-[11px] text-slate-500 mb-1">離職原因 Top 3</div>
          ${topReasons.length === 0 ? '<div class="text-xs text-slate-400">—</div>' :
            topReasons.map(([t, c]) => `<div class="flex justify-between text-xs"><span class="text-slate-700 truncate mr-2">${t}</span><span class="font-semibold text-slate-600">${c}</span></div>`).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function renderDeptTable() {
  const data = FILTERED.departments.filter(d => d.resignations + d.new_hires + d.current > 0);
  const html = `
    <table class="data-table">
      <thead>
        <tr>
          <th>部門</th><th class="text-right">在職</th><th class="text-right">離職</th>
          <th class="text-right">到職</th><th class="text-right">淨增減</th><th class="text-right">流失率</th>
          <th class="text-right">新增職缺</th><th class="text-right">遞補職缺</th><th class="text-right">未補</th>
        </tr>
      </thead>
      <tbody>
        ${data.map(d => `
          <tr class="cursor-pointer" onclick="drillByDept('${escapeAttr(d.name)}')">
            <td class="font-medium text-blue-700 hover:underline">${d.name}</td>
            <td class="text-right">${fmtNum(d.current)}</td>
            <td class="text-right text-red-600">${d.resignations || '-'}</td>
            <td class="text-right text-emerald-600">${d.new_hires || '-'}</td>
            <td class="text-right ${d.net < 0 ? 'text-red-600' : d.net > 0 ? 'text-emerald-600' : ''}">${d.net > 0 ? '+' + d.net : d.net}</td>
            <td class="text-right">
              ${d.turnover_rate ? `<span class="badge ${d.turnover_rate >= 30 ? 'risk-high' : d.turnover_rate >= 15 ? 'risk-mid' : 'risk-low'}">${d.turnover_rate}%</span>` : '-'}
            </td>
            <td class="text-right">${d.open_new || '-'}</td>
            <td class="text-right">${d.open_backfill || '-'}</td>
            <td class="text-right ${d.pending_fill > 0 ? 'text-amber-600 font-semibold' : ''}">${d.pending_fill || '-'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  document.getElementById('dept-table').innerHTML = html;
}

function drillByDept(deptName) {
  const sel = document.getElementById('filter-dept');
  // 部門下拉的 option value 是 dept name
  sel.value = deptName;
  if (sel.value === deptName) {
    applyFilters();
    // 滾到頁面頂端讓使用者看到 KPI 更新
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function drillByTitle(titleName) {
  const sel = document.getElementById('filter-title');
  sel.value = titleName;
  if (sel.value === titleName) {
    applyFilters();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function escapeAttr(s) {
  return String(s).replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

function populatePosFilterOptions() {
  const data = FILTERED.open_positions || [];
  const fill = (id, vals, cur) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const keep = cur != null ? cur : sel.value;
    sel.innerHTML = '<option value="">全部</option>' +
      vals.map(v => `<option value="${escapeAttr(v)}"${v === keep ? ' selected' : ''}>${v}</option>`).join('');
  };
  const months = [...new Set(data.map(p => p.month).filter(Boolean))].sort((a, b) => a - b).map(m => `${m}`);
  const bizs = [...new Set(data.map(p => p.biz).filter(Boolean))].sort();
  fill('pos-filter-month', months);
  fill('pos-filter-biz', bizs);
  // course 依 biz 連動
  const bizSel = document.getElementById('pos-filter-biz');
  const bizVal = bizSel ? bizSel.value : '';
  const courses = [...new Set(data
    .filter(p => !bizVal || p.biz === bizVal)
    .map(p => p.course).filter(c => c && c !== '-'))].sort();
  fill('pos-filter-course', courses);
}

function onPosBizChange() {
  // 換 biz 時清掉舊 course 選項
  const cs = document.getElementById('pos-filter-course');
  if (cs) cs.value = '';
  renderPositionsTable();
}

function clearPosFilters() {
  ['pos-filter-month', 'pos-filter-biz', 'pos-filter-course', 'pos-filter-status'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const kw = document.getElementById('pos-filter-keyword');
  if (kw) kw.value = '';
  JOB_TYPE_FILTER = '';
  renderPositionsTable();
}

function renderPositionsTable() {
  populatePosFilterOptions();
  let data = FILTERED.open_positions;
  if (JOB_TYPE_FILTER) data = data.filter(p => p.type === JOB_TYPE_FILTER);

  // 套用新篩選
  const month = document.getElementById('pos-filter-month')?.value || '';
  const biz = document.getElementById('pos-filter-biz')?.value || '';
  const course = document.getElementById('pos-filter-course')?.value || '';
  const status = document.getElementById('pos-filter-status')?.value || '';
  const kw = (document.getElementById('pos-filter-keyword')?.value || '').trim().toLowerCase();

  if (month) data = data.filter(p => String(p.month) === month);
  if (biz) data = data.filter(p => p.biz === biz);
  if (course) data = data.filter(p => p.course === course);
  if (status) data = data.filter(p => {
    if (status === 'pending') return p.pending > 0 && (p.hired || 0) === 0;
    if (status === 'filled') return p.pending === 0 && (p.hired || 0) >= p.demand;
    if (status === 'partial') return p.pending > 0 && (p.hired || 0) > 0;
    return true;
  });
  if (kw) data = data.filter(p =>
    (p.position || '').toLowerCase().includes(kw)
  );

  const countEl = document.getElementById('pos-filter-count');
  if (countEl) countEl.textContent = `共 ${data.length} 筆`;

  const html = `
    <table class="data-table">
      <thead>
        <tr>
          <th>月份</th><th>事業單位</th><th>課別</th><th>職位</th>
          <th class="text-right">需求</th><th class="text-right">已錄取</th><th class="text-right">未補</th>
          <th>類型</th><th>開缺日</th>
        </tr>
      </thead>
      <tbody>
        ${data.map(p => `
          <tr>
            <td>${p.month}月</td>
            <td class="text-slate-600 ${p.biz ? 'hover:underline cursor-pointer text-blue-700' : ''}" ${p.biz ? `onclick="drillByDept('${escapeAttr(p.biz)}')"` : ''}>${p.biz || '-'}</td>
            <td class="${p.course ? 'hover:underline cursor-pointer text-blue-700' : ''}" ${p.course ? `onclick="drillByDept('${escapeAttr(p.course)}')"` : ''}>${p.course || '-'}</td>
            <td class="font-medium hover:underline cursor-pointer" onclick="drillByTitle('${escapeAttr(p.position)}')">${p.position}</td>
            <td class="text-right">${p.demand}</td>
            <td class="text-right text-emerald-600">${p.hired || '-'}</td>
            <td class="text-right ${p.pending > 0 ? 'text-amber-600 font-semibold' : ''}">${p.pending || '-'}</td>
            <td><span class="badge ${p.type === '新增' ? 'badge-new' : p.type === '離職遞補' ? 'badge-backfill' : 'badge-pending'}">${p.type || '未分類'}</span></td>
            <td class="text-slate-500 text-xs">${p.open_dt || '-'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  document.getElementById('positions-table').innerHTML = html;
}

function renderResignTable() {
  const data = FILTERED.resignation_list;
  if (data.length === 0) {
    document.getElementById('resign-table').innerHTML = emptyState('此條件下無離職人員');
    return;
  }
  const html = `
    <table class="data-table">
      <thead>
        <tr><th>工號</th><th>姓名</th><th>部門</th><th>職務</th><th>離職日</th><th>原因</th><th class="text-right">年資</th></tr>
      </thead>
      <tbody>
        ${data.map(r => {
          const leaveBadge = r.was_on_leave
            ? ` <span class="badge bg-violet-100 text-violet-800 text-[10px]" title="${escapeAttr(r.leave_note || '留停期間未復職直接離職')}">留停未復職</span>`
            : '';
          return `
            <tr>
              <td class="font-mono text-xs">${r.id || '-'}</td>
              <td class="font-medium">${r.name}${leaveBadge}</td>
              <td class="text-blue-700 hover:underline cursor-pointer" onclick="drillByDept('${escapeAttr(r.dept)}')">${r.dept}</td>
              <td class="text-slate-600 text-xs hover:underline cursor-pointer" onclick="drillByTitle('${escapeAttr(r.title)}')">${r.title}</td>
              <td class="text-slate-500 text-xs">${r.leave || '-'}</td>
              <td><span class="badge badge-pending">${r.reason}</span></td>
              <td class="text-right text-xs text-slate-500">${formatTenure(r.tenure_days)}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
  document.getElementById('resign-table').innerHTML = html;
}

// 跳到「離職→遞補配對明細」並套狀態過濾
function showBackfillDetail(status) {
  const sel = document.getElementById('filter-backfill-status');
  if (sel) sel.value = status || '';
  // 展開 details
  const detail = sel ? sel.closest('details') : null;
  if (detail) detail.open = true;
  renderBackfillAnalysis();
  // 捲動到明細
  const tbl = document.getElementById('backfill-detail-table');
  if (tbl) tbl.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderBackfillAnalysis() {
  // 從 FILTERED.resignation_list 即時重算 (才會跟篩選條件聯動)
  const list = FILTERED.resignation_list;
  const matched = list.filter(r => r.backfill_gap_days !== null && r.backfill_gap_days !== undefined);
  const total = list.length;
  const mc = matched.length;
  const uc = total - mc;
  // 平均/最長：只算「真正有空窗」(gap > 0) 的；不含提前補位 (gap <= 0)、不含未遞補
  const realGap = matched.filter(r => r.backfill_gap_days > 0);
  const avg = realGap.length ? Math.round(realGap.reduce((s, r) => s + r.backfill_gap_days, 0) / realGap.length * 10) / 10 : 0;
  const maxG = realGap.length ? Math.max(...realGap.map(r => r.backfill_gap_days)) : 0;

  document.getElementById('bf-matched').textContent = mc;
  document.getElementById('bf-matched-pct').textContent = total ? Math.round(mc / total * 100) + '% / 全部離職' : '-';
  document.getElementById('bf-unmatched').textContent = uc;
  document.getElementById('bf-unmatched-pct').textContent = total ? Math.round(uc / total * 100) + '% 尚未補上' : '-';
  document.getElementById('bf-avg').textContent = realGap.length ? avg : '-';
  document.getElementById('bf-max').textContent = realGap.length ? maxG : '-';

  // 提前補位（無斷層交接）統計 + 點擊跳明細
  const seamlessCount = matched.filter(r => r.backfill_gap_days < 0).length;
  document.getElementById('bf-seamless').textContent = seamlessCount;
  const seamlessLink = document.getElementById('bf-seamless-link');
  if (seamlessLink && !seamlessLink.dataset.bound) {
    seamlessLink.dataset.bound = '1';
    seamlessLink.addEventListener('click', (e) => {
      e.preventDefault();
      showBackfillDetail('提前補位');
    });
  }

  // 分布
  const buckets = [
    { name: '提前補位\n(<0 天)', pred: r => r.backfill_gap_days < 0, color: '#06b6d4' },
    { name: '0-14 天', pred: r => r.backfill_gap_days >= 0 && r.backfill_gap_days <= 14, color: '#10b981' },
    { name: '15-30 天', pred: r => r.backfill_gap_days >= 15 && r.backfill_gap_days <= 30, color: '#84cc16' },
    { name: '31-60 天', pred: r => r.backfill_gap_days >= 31 && r.backfill_gap_days <= 60, color: '#fbbf24' },
    { name: '61-90 天', pred: r => r.backfill_gap_days >= 61 && r.backfill_gap_days <= 90, color: '#f59e0b' },
    { name: '> 90 天', pred: r => r.backfill_gap_days > 90, color: '#ef4444' },
    { name: '未遞補', pred: null, color: '#94a3b8' },
  ];
  const distData = buckets.map(b => ({
    name: b.name,
    count: b.pred ? matched.filter(b.pred).length : uc,
    color: b.color,
  }));

  destroyChart('backfillDist');
  const ctx = document.getElementById('chart-backfill-dist');
  CHARTS.backfillDist = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: distData.map(d => d.name),
      datasets: [{
        label: '離職人數', data: distData.map(d => d.count),
        backgroundColor: distData.map(d => d.color),
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      onClick: (evt, els) => {
        if (!els || !els.length) return;
        const idx = els[0].index;
        // 對應 buckets：0=提前補位 / 6=未遞補 / 其餘=已遞補
        let status = '';
        if (idx === 0) status = '提前補位';
        else if (idx === 6) status = '未遞補';
        else status = '已遞補';
        showBackfillDetail(status);
      },
      onHover: (evt, els) => {
        evt.native.target.style.cursor = els.length ? 'pointer' : 'default';
      }
    }
  });

  // 動態填入「部門」下拉
  const deptSel = document.getElementById('filter-backfill-dept');
  const statusSel = document.getElementById('filter-backfill-status');
  if (deptSel) {
    const depts = [...new Set(list.map(r => r.dept).filter(Boolean))].sort();
    const cur = deptSel.value;
    deptSel.innerHTML = '<option value="">全部</option>' +
      depts.map(d => `<option value="${d}"${d === cur ? ' selected' : ''}>${d}</option>`).join('');
  }

  const stFilter = statusSel ? statusSel.value : '';
  const dpFilter = deptSel ? deptSel.value : '';

  // 明細表格 (按空窗天數降冪) + 套用下拉篩選
  const matchStatus = (r) => {
    if (!stFilter) return true;
    if (stFilter === 'ALL_MATCHED') return r.backfill_status === '已遞補' || r.backfill_status === '提前補位';
    return r.backfill_status === stFilter;
  };
  const sorted = [...list]
    .filter(matchStatus)
    .filter(r => !dpFilter || r.dept === dpFilter)
    .sort((a, b) => {
      const av = a.backfill_gap_days == null ? -999999 : a.backfill_gap_days;
      const bv = b.backfill_gap_days == null ? -999999 : b.backfill_gap_days;
      return bv - av;
    });
  const html = `
    <table class="data-table">
      <thead>
        <tr>
          <th>離職日</th><th>部門</th><th>離職者</th><th>職務</th>
          <th>遞補新人</th><th>到職日</th><th class="text-right">空窗天數</th><th>狀態</th>
        </tr>
      </thead>
      <tbody>
        ${sorted.map(r => `
          <tr>
            <td class="text-xs text-slate-500">${r.leave || '-'}</td>
            <td>${r.dept}</td>
            <td class="font-medium">${r.name}</td>
            <td class="text-slate-600 text-xs">${r.title}</td>
            <td class="font-medium">${r.matched_new_hire_name || '<span class="text-red-500">—</span>'}</td>
            <td class="text-xs text-slate-500">${r.matched_new_hire_start || '-'}</td>
            <td class="text-right ${gapColor(r.backfill_gap_days)}">${r.backfill_gap_days != null ? r.backfill_gap_days + ' 天' : '-'}</td>
            <td><span class="badge ${r.backfill_status === '已遞補' ? 'badge-active' : r.backfill_status === '提前補位' ? 'badge-new' : 'badge-resigned'}">${r.backfill_status}</span></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  document.getElementById('backfill-detail-table').innerHTML = html;
}

function gapColor(d) {
  if (d == null) return 'text-slate-400';
  if (d < 0) return 'text-cyan-600 font-semibold';
  if (d <= 14) return 'text-emerald-600';
  if (d <= 30) return 'text-lime-600';
  if (d <= 60) return 'text-amber-600';
  return 'text-red-600 font-semibold';
}

function renderNewHireTable() {
  const data = FILTERED.new_hire_list;
  if (data.length === 0) {
    document.getElementById('newhire-table').innerHTML = emptyState('此條件下無新進人員');
    return;
  }
  const html = `
    <table class="data-table">
      <thead>
        <tr><th>工號</th><th>姓名</th><th>部門</th><th>職務</th><th>到職日</th><th>狀態</th></tr>
      </thead>
      <tbody>
        ${data.map(n => `
          <tr>
            <td class="font-mono text-xs">${n.id || '-'}</td>
            <td class="font-medium">${n.name}</td>
            <td class="text-blue-700 hover:underline cursor-pointer" onclick="drillByDept('${escapeAttr(n.dept)}')">${n.dept}</td>
            <td class="text-slate-600 text-xs hover:underline cursor-pointer" onclick="drillByTitle('${escapeAttr(n.title)}')">${n.title}</td>
            <td class="text-slate-500 text-xs">${n.start || '-'}</td>
            <td>
              ${n.still_active
                ? '<span class="badge badge-active">在職</span>'
                : `<span class="badge badge-resigned">已離職 ${n.left_dt || ''}</span>`}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  document.getElementById('newhire-table').innerHTML = html;
}

function emptyState(msg) {
  return `<div class="text-center py-12 text-slate-400">
    <svg class="w-12 h-12 mx-auto mb-2 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
    </svg>
    <p class="text-sm">${msg}</p>
  </div>`;
}

function formatTenure(days) {
  if (days == null) return '-';
  if (days < 30) return days + ' 天';
  if (days < 365) return Math.round(days / 30) + ' 個月';
  return (days / 365).toFixed(1) + ' 年';
}

// ========== 招募漏斗 × FB 廣告效益 ==========
// 計算「依當前篩選」後的 funnel 視圖
function computeFunnelView() {
  const d = FUNNEL_DATA;
  if (!d) return null;
  const dept = (document.getElementById('filter-dept') || {}).value || '';
  const monthFrom = (document.getElementById('filter-month-from') || {}).value || '';
  const monthTo = (document.getElementById('filter-month-to') || {}).value || '';
  // 期間轉日期
  const dateFrom = monthFrom ? monthFrom + '-01' : null;
  const dateTo = monthTo ? lastDayOfMonth(monthTo) : null;

  // 1) by_job：若有選 dept，做單位匹配
  // HR 部門 ex: "南區業務二課" / "北區業務一課" / "中區業務一課" / "和美站"
  // funnel unit ex: "南二" / "北一" / "中一" / "和美站"
  // 規則：抽出 dept 內的 [南北中東西] 區碼 + [一二三四五] 數字，組合成短碼比對
  let by_job = d.by_job || [];
  if (dept) {
    by_job = by_job.filter(r => deptMatchesUnit(dept, r.unit || ''));
  }

  // 2) campaigns：依 date_start/date_stop 與篩選期間重疊
  let camps = d.fb_campaigns_raw || [];
  if (dateFrom && dateTo) {
    camps = camps.filter(c => {
      const s = c.date_start || '';
      const e = c.date_stop || '';
      if (!s || !e) return true;
      return !(e < dateFrom || s > dateTo);
    });
  }

  // 3) 用過濾後資料重算 summary（部門/期間任一篩選有套用時才走重算）
  const usedFilter = !!dept || (dateFrom && dateTo);
  let summary;
  if (usedFilter) {
    const sumBy = (k) => by_job.reduce((acc, r) => acc + (r[k] || 0), 0);
    const sumCamp = (k) => camps.reduce((acc, r) => acc + (r[k] || 0), 0);
    // 部門篩選用 by_job 維度（spend/leads 都是 per-job 拆分後的值）
    // 無部門篩選用 campaign 維度（避免共用廣告重複加總）
    const totalLeads = dept ? sumBy('fb_leads') : sumCamp('leads');
    const totalSpend = dept ? sumBy('fb_spend') : sumCamp('spend');
    // ATS 累計指標（intake/invited/hired）只在「無部門篩選」時用全公司值；
    // 有部門篩選時，因 producer 的 by_job 沒提供 per-job ATS hired，回傳 null 由 UI 顯示「-」
    const atsAvailable = !dept;
    summary = {
      fb_total_spend: totalSpend,
      fb_total_leads: totalLeads,
      fb_avg_cpl: totalLeads ? totalSpend / totalLeads : 0,
      fb_total_in_ats: sumBy('fb_in_ats'),
      fb_total_invited: sumBy('fb_invited'),
      fb_total_uninvited: sumBy('fb_not_invited'),
      fb_total_contacted_fail: sumBy('fb_contacted_fail'),
      fb_total_not_contacted: sumBy('fb_not_contacted'),
      fb_total_uninvited_other: sumBy('fb_uninvited_other'),
      fb_total_pending_followup: sumBy('fb_pending_followup'),
      ats_total_intake: atsAvailable ? d.summary.ats_total_intake : null,
      ats_total_invited: atsAvailable ? d.summary.ats_total_invited : null,
      ats_total_hired: atsAvailable ? d.summary.ats_total_hired : null,
      _filtered: true,
      _dept: dept,
      _byJobCount: by_job.length,
    };
  } else {
    summary = d.summary || {};
  }

  // 4) pending_followup：依 dept 過濾
  let pending = d.pending_followup || { total: 0, by_job: [] };
  if (dept) {
    const filteredBy = (pending.by_job || []).filter(j => {
      const match = by_job.find(b => b.job_title === j.job);
      return !!match;
    });
    pending = { total: filteredBy.reduce((s, j) => s + (j.count || 0), 0), by_job: filteredBy };
  }

  return { by_job, camps, summary, pending, dept, dateFrom, dateTo };
}

// HR 部門名 ↔ funnel.unit 短碼比對
function deptMatchesUnit(dept, unit) {
  if (!unit) return false;
  if (dept === unit) return true;
  if (dept.includes(unit) || unit.includes(dept)) return true;
  // 抽 dept 區域字 + 一二三 → 短碼
  const regionMatch = dept.match(/[南北中東西]/);
  const numMatch = dept.match(/[一二三四五六七八九]/);
  if (regionMatch && numMatch) {
    const short = regionMatch[0] + numMatch[0]; // ex: 南二
    if (unit === short || unit.includes(short)) return true;
  }
  // funnel unit 反向：例如 unit="和美站" dept="和美站業務課" 之類
  return false;
}

function lastDayOfMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m, 0);
  return ym + '-' + String(d.getDate()).padStart(2, '0');
}

function renderFunnelSection() {
  const sec = document.getElementById('section-funnel');
  if (!sec) return;
  if (!FUNNEL_DATA) { sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');

  const view = computeFunnelView();
  const d = FUNNEL_DATA;
  const s = view.summary;
  const p = d.period || {};

  // 期間文字：永遠顯示 producer 原始期間 + 標註是否套用篩選
  let periodTxt = (p.start || '?') + ' ~ ' + (p.end || '?') + '　|　更新 ' + (d.generated_at || '').slice(0, 16).replace('T', ' ');
  if (s._filtered) {
    const tag = [];
    if (view.dept) tag.push('單位=' + view.dept);
    if (view.dateFrom && view.dateTo) tag.push('期間=' + view.dateFrom + '~' + view.dateTo);
    periodTxt += '　|　🔍 已套用篩選（' + tag.join(', ') + '）';
  }
  document.getElementById('funnel-period').textContent = periodTxt;

  // 無 leads → 整段視為「無資料」（部門沒做 FB 刊登 / 期間沒有 campaign）
  const noLeads = !(s.fb_total_leads > 0);
  document.getElementById('funnel-spend').textContent = fmtNum(Math.round(s.fb_total_spend || 0));
  document.getElementById('funnel-leads').textContent = fmtNum(s.fb_total_leads || 0);
  document.getElementById('funnel-in-ats').textContent = noLeads ? '-' : fmtNum(s.fb_total_in_ats || 0);
  document.getElementById('funnel-invited').textContent = noLeads ? '-' : fmtNum(s.fb_total_invited || 0);
  document.getElementById('funnel-hired').textContent = s.ats_total_hired == null ? '-' : fmtNum(s.ats_total_hired);
  document.getElementById('funnel-cpl').textContent = (s.fb_avg_cpl || 0).toFixed(1);

  const leadsToAts = (!noLeads && s.fb_total_leads) ? (s.fb_total_in_ats / s.fb_total_leads * 100).toFixed(1) + '%' : '-';
  const inAtsToInv = (!noLeads && s.fb_total_in_ats) ? (s.fb_total_invited / s.fb_total_in_ats * 100).toFixed(1) + '%' : '-';
  document.getElementById('funnel-in-ats-rate').textContent = leadsToAts;
  document.getElementById('funnel-invited-rate').textContent = inAtsToInv;

  // 部門有篩選但 by_job 沒對到 → 在區塊頂端顯示明確警示
  let noDataBanner = document.getElementById('funnel-nodata-banner');
  if (!noDataBanner) {
    noDataBanner = document.createElement('div');
    noDataBanner.id = 'funnel-nodata-banner';
    noDataBanner.className = 'mb-4 bg-amber-50 border border-amber-300 text-amber-900 rounded-lg px-4 py-3 text-sm';
    sec.insertBefore(noDataBanner, sec.firstChild.nextSibling);
  }
  if (s._filtered && s._dept && s._byJobCount === 0) {
    noDataBanner.innerHTML = '<span class="font-medium">⚠️ 「' + s._dept + '」沒有 FB 廣告刊登紀錄</span>'
      + '（funnel.unit 對應不到此部門 — 此部門可能未經 FB 招募，或僅在 104/其他管道刊登）';
    noDataBanner.classList.remove('hidden');
  } else {
    noDataBanner.classList.add('hidden');
  }

  renderFunnelChart(s);
  renderFunnelReasonsChart(s);
  renderFunnelByJob(view.by_job);
  renderFunnelCampaigns(view.camps);
  renderFunnelPendingStats(view.pending);
  renderFunnelCrossChannel(d, view);
  renderFunnelApplicants(d, view);
}

// FB 應徵者名單（含狀態 / 部門 / 職缺）
function renderFunnelApplicants(d, view) {
  const wrap = document.getElementById('fb-apl-table');
  if (!wrap) return;
  const all = d.fb_applicants || [];
  const monthFrom = view.dateFrom ? view.dateFrom.slice(0, 7) : '';
  const monthTo = view.dateTo ? view.dateTo.slice(0, 7) : '';
  const dept = view.dept || '';
  const inRange = (date) => {
    const m = (date || '').slice(0, 7);
    return (!monthFrom || m >= monthFrom) && (!monthTo || m <= monthTo);
  };
  const deptMatch = (rDept, rUnit) => {
    if (!dept) return true;
    return rDept === dept || (rUnit && deptMatchesUnit(dept, rUnit)) || rDept.includes(dept);
  };
  let rows = all.filter(r => inRange(r.contactDate) && deptMatch(r.dept, r.unit));

  const statusSel = document.getElementById('fb-apl-status');
  const searchInp = document.getElementById('fb-apl-search');
  const statusFilter = statusSel ? statusSel.value : '';
  const q = (searchInp ? searchInp.value : '').trim().toLowerCase();
  if (statusFilter) rows = rows.filter(r => r.status === statusFilter);
  if (q) rows = rows.filter(r =>
    (r.name || '').toLowerCase().includes(q) ||
    (r.jobTitle || '').toLowerCase().includes(q) ||
    (r.dept || '').toLowerCase().includes(q));

  document.getElementById('fb-apl-total').textContent = rows.length;

  // 狀態色彩
  const statusBadge = (s) => {
    const map = {
      '已報到':       'bg-emerald-100 text-emerald-700',
      '已邀約':       'bg-amber-100 text-amber-700',
      '已發 offer':   'bg-sky-100 text-sky-700',
      '謝絕錄取':     'bg-orange-100 text-orange-700',
      '未通過篩選':   'bg-slate-200 text-slate-700',
      '已聯繫未成功': 'bg-rose-100 text-rose-700',
      '尚未聯繫':     'bg-yellow-100 text-yellow-800',
      '未報到':       'bg-red-100 text-red-700',
      '待跟進':       'bg-indigo-100 text-indigo-700',
    };
    const cls = map[s] || 'bg-slate-100 text-slate-700';
    return `<span class="px-2 py-0.5 rounded text-[11px] ${cls}">${s}</span>`;
  };

  const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const MAX = 300;
  const shown = rows.slice(0, MAX);
  const head = `<thead class="bg-slate-50 sticky top-0">
    <tr class="text-xs text-slate-600">
      <th class="text-left px-3 py-2">聯絡日期</th>
      <th class="text-left px-3 py-2">姓名</th>
      <th class="text-left px-3 py-2">電話</th>
      <th class="text-left px-3 py-2">部門</th>
      <th class="text-left px-3 py-2">職缺</th>
      <th class="text-left px-3 py-2">狀態</th>
      <th class="text-left px-3 py-2">備註</th>
    </tr></thead>`;
  const body = shown.map(r => `<tr class="border-t border-slate-100 text-sm hover:bg-slate-50">
    <td class="px-3 py-1.5 text-slate-600 whitespace-nowrap">${esc(r.contactDate)}</td>
    <td class="px-3 py-1.5 font-medium">${esc(r.name)}</td>
    <td class="px-3 py-1.5 text-slate-500 whitespace-nowrap">${esc(r.phone)}</td>
    <td class="px-3 py-1.5 text-slate-700 whitespace-nowrap">${esc(r.dept)}</td>
    <td class="px-3 py-1.5 text-slate-700">${esc(r.jobTitle)}</td>
    <td class="px-3 py-1.5">${statusBadge(r.status)}</td>
    <td class="px-3 py-1.5 text-xs text-slate-500 max-w-[260px] truncate" title="${esc(r.phoneScreenNote)}">${esc(r.phoneScreenNote)}</td>
  </tr>`).join('');
  const moreMsg = rows.length > MAX ? `<tr><td colspan="7" class="text-center text-xs text-slate-400 py-2">顯示前 ${MAX} 筆 / 共 ${rows.length} 筆，請用搜尋/篩選縮小範圍</td></tr>` : '';
  wrap.innerHTML = `<table class="min-w-full text-sm">${head}<tbody>${body}${moreMsg}</tbody></table>`;

  // 綁定 filter 事件（只綁一次）
  if (statusSel && !statusSel._bound) {
    statusSel.addEventListener('change', () => renderFunnelApplicants(d, computeFunnelView()));
    statusSel._bound = true;
  }
  if (searchInp && !searchInp._bound) {
    let t;
    searchInp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => renderFunnelApplicants(d, computeFunnelView()), 200); });
    searchInp._bound = true;
  }
}

// FB 廣告總影響力：直接路徑 + 跨管道路徑 + 整體入職率
function renderFunnelCrossChannel(d, view) {
  const card = document.getElementById('funnel-cross-channel');
  if (!card) return;
  const cc = d.fb_cross_channel;
  const monthFrom = view.dateFrom ? view.dateFrom.slice(0, 7) : '';
  const monthTo = view.dateTo ? view.dateTo.slice(0, 7) : '';
  const inRangeMonth = (m) => (!monthFrom || m >= monthFrom) && (!monthTo || m <= monthTo);

  // ① 直接路徑：FB by_month 扣掉跨管道 = 直接從 FB 表單進 ATS 的部分
  const bm = (d.by_month || []).filter(m => inRangeMonth(m.month));
  const allIn = bm.reduce((s, m) => s + (m.in_ats || 0), 0);
  const allInv = bm.reduce((s, m) => s + (m.invited || 0), 0);
  const allHi = bm.reduce((s, m) => s + (m.hired || 0), 0);

  // ② 跨管道路徑：fb_cross_channel
  const crossArr = (cc && cc.by_source_month) ? cc.by_source_month.filter(x => inRangeMonth(x.in_month || '')) : [];
  const crossTotal = crossArr.length;
  const crossInvited = crossArr.filter(x => x.invited).length;
  const crossHired = crossArr.filter(x => x.hired).length;
  const cnt = (src) => crossArr.filter(x => x.src === src).length;

  // 直接 = 全部 - 跨管道
  const directIn = Math.max(0, allIn - crossTotal);
  const directInv = Math.max(0, allInv - crossInvited);
  const directHi = Math.max(0, allHi - crossHired);

  // 沒任何 FB 資料 → 隱藏整塊
  if (allIn === 0 && crossTotal === 0) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');

  // 直接路徑
  document.getElementById('cc-direct-in-ats').textContent = fmtNum(directIn);
  document.getElementById('cc-direct-invited').textContent = fmtNum(directInv);
  document.getElementById('cc-direct-hired').textContent = fmtNum(directHi);
  // 跨管道路徑
  document.getElementById('cc-cross-total').textContent = fmtNum(crossTotal);
  document.getElementById('cc-cross-invited').textContent = fmtNum(crossInvited);
  document.getElementById('cc-cross-hired').textContent = fmtNum(crossHired);
  document.getElementById('cc-cross-104').textContent = cnt('104');
  document.getElementById('cc-cross-1111').textContent = cnt('1111');
  document.getElementById('cc-cross-website').textContent = cnt('website');
  // 合計
  document.getElementById('cc-total-in-ats').textContent = fmtNum(allIn);
  document.getElementById('cc-total-invited').textContent = fmtNum(allInv);
  document.getElementById('cc-total-hired').textContent = fmtNum(allHi);
  // 整體入職率 = 總報到 / 總進 ATS
  const rate = allIn > 0 ? (allHi / allIn * 100).toFixed(1) + '%' : '—';
  document.getElementById('cc-overall-rate').textContent = rate;
  document.getElementById('cc-overall-rate-note').textContent = allIn > 0 ? `${allHi} / ${allIn} 進 ATS` : '—';
}

function renderFunnelChart(s) {
  s = s || FUNNEL_DATA.summary || {};
  destroyChart('funnel');
  const ctx = document.getElementById('chart-funnel');
  if (!ctx) return;
  const labels = ['FB Leads', '進 ATS', '已邀約', '已報到'];
  const values = [s.fb_total_leads || 0, s.fb_total_in_ats || 0, s.fb_total_invited || 0, s.ats_total_hired || 0];
  const colors = ['#3b82f6', '#06b6d4', '#f59e0b', '#10b981'];
  CHARTS.funnel = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 4 }] },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function (c) {
              const v = c.parsed.x;
              const base = values[0];
              const pct = base ? ((v / base) * 100).toFixed(1) + '%' : '-';
              return ' ' + fmtNum(v) + '（占 Leads ' + pct + '）';
            }
          }
        }
      },
      scales: { x: { beginAtZero: true } }
    }
  });
}

function renderFunnelReasonsChart(s) {
  s = s || FUNNEL_DATA.summary || {};
  destroyChart('funnelReasons');
  const ctx = document.getElementById('chart-funnel-reasons');
  if (!ctx) return;
  const wrap = ctx.parentElement;
  // 確保 wrap 是 relative，方便空狀態 overlay 定位
  if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
  // 移除舊的 overlay（若有）
  const oldOverlay = wrap.querySelector('.chart-empty-overlay');
  if (oldOverlay) oldOverlay.remove();
  const data = [
    { label: '已聯繫未成功', value: s.fb_total_contacted_fail || 0, color: '#ef4444' },
    { label: '尚未聯繫', value: s.fb_total_not_contacted || 0, color: '#f59e0b' },
    { label: '備註空白待跟進', value: s.fb_total_pending_followup || 0, color: '#6366f1' },
    { label: '其他', value: s.fb_total_uninvited_other || 0, color: '#94a3b8' }
  ].filter(function (x) { return x.value > 0; });
  if (!data.length) {
    // 用 overlay 蓋上空狀態，不動 canvas
    const overlay = document.createElement('div');
    overlay.className = 'chart-empty-overlay';
    overlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.9);pointer-events:none;';
    overlay.innerHTML = emptyState('本期間無未邀約資料');
    wrap.appendChild(overlay);
    return;
  }
  CHARTS.funnelReasons = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: data.map(function (x) { return x.label; }),
      datasets: [{
        data: data.map(function (x) { return x.value; }),
        backgroundColor: data.map(function (x) { return x.color; }),
        borderWidth: 2, borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: function (c) {
              const total = data.reduce(function (a, x) { return a + x.value; }, 0);
              const pct = total ? ((c.parsed / total) * 100).toFixed(1) + '%' : '-';
              return ' ' + c.label + ': ' + fmtNum(c.parsed) + '（' + pct + '）';
            }
          }
        }
      }
    }
  });
}

function renderFunnelByJob(rows) {
  rows = rows || FUNNEL_DATA.by_job || [];
  const sk = FUNNEL_BYJOB_SORT;
  const sorted = rows.slice().sort(function (a, b) {
    const av = a[sk.key], bv = b[sk.key];
    const aV = av == null ? 0 : av;
    const bV = bv == null ? 0 : bv;
    if (typeof aV === 'string') return sk.desc ? String(bV).localeCompare(String(aV)) : String(aV).localeCompare(String(bV));
    return sk.desc ? bV - aV : aV - bV;
  });
  const arrow = function (k) { return sk.key === k ? (sk.desc ? ' ▼' : ' ▲') : ''; };
  const th = function (k, label, cls) {
    return '<th class="px-2 py-2 text-xs font-medium text-slate-600 cursor-pointer hover:bg-slate-100 ' + (cls || '') + '" onclick="sortFunnelByJob(\'' + k + '\')">' + label + arrow(k) + '</th>';
  };
  const pct = function (a, b) { return b ? ((a / b) * 100).toFixed(1) + '%' : '-'; };
  // 計算總計
  const tot = rows.reduce(function (a, r) {
    a.spend += r.fb_spend || 0;
    a.leads += r.fb_leads || 0;
    a.in_ats += r.fb_in_ats || 0;
    a.invited += r.fb_invited || 0;
    a.contacted_fail += r.fb_contacted_fail || 0;
    a.not_contacted += r.fb_not_contacted || 0;
    a.pending += r.fb_pending_followup || 0;
    return a;
  }, { spend: 0, leads: 0, in_ats: 0, invited: 0, contacted_fail: 0, not_contacted: 0, pending: 0 });
  const totCpl = tot.leads ? tot.spend / tot.leads : 0;
  const totalRow = '<tr class="border-t-2 border-slate-300 bg-slate-100 font-bold">' +
    '<td class="px-2 py-2 text-xs text-slate-900" colspan="2">總計（' + rows.length + ' 職缺）</td>' +
    '<td class="px-2 py-2 text-xs text-right text-rose-700">$' + fmtNum(Math.round(tot.spend)) + '</td>' +
    '<td class="px-2 py-2 text-xs text-right">' + fmtNum(tot.leads) + '</td>' +
    '<td class="px-2 py-2 text-xs text-right text-slate-700">$' + totCpl.toFixed(1) + '</td>' +
    '<td class="px-2 py-2 text-xs text-right text-cyan-800">' + fmtNum(tot.in_ats) + '</td>' +
    '<td class="px-2 py-2 text-xs text-right text-slate-600">' + pct(tot.in_ats, tot.leads) + '</td>' +
    '<td class="px-2 py-2 text-xs text-right text-amber-800">' + fmtNum(tot.invited) + '</td>' +
    '<td class="px-2 py-2 text-xs text-right text-slate-600">' + pct(tot.invited, tot.in_ats) + '</td>' +
    '<td class="px-2 py-2 text-xs text-right text-red-700">' + fmtNum(tot.contacted_fail) + '</td>' +
    '<td class="px-2 py-2 text-xs text-right text-amber-700">' + fmtNum(tot.not_contacted) + '</td>' +
    '<td class="px-2 py-2 text-xs text-right text-indigo-700">' + fmtNum(tot.pending) + '</td>' +
    '</tr>';
  const body = sorted.map(function (r) {
    return '<tr class="border-t border-slate-100 hover:bg-slate-50">' +
      '<td class="px-2 py-2 text-xs text-slate-600">' + (r.unit || '-') + '</td>' +
      '<td class="px-2 py-2 text-xs font-medium text-slate-900">' + (r.job_title || '-') + '</td>' +
      '<td class="px-2 py-2 text-xs text-right text-rose-600">$' + fmtNum(Math.round(r.fb_spend || 0)) + '</td>' +
      '<td class="px-2 py-2 text-xs text-right font-semibold">' + fmtNum(r.fb_leads || 0) + '</td>' +
      '<td class="px-2 py-2 text-xs text-right text-slate-500">$' + (r.fb_cpl || 0).toFixed(1) + '</td>' +
      '<td class="px-2 py-2 text-xs text-right text-cyan-700">' + fmtNum(r.fb_in_ats || 0) + '</td>' +
      '<td class="px-2 py-2 text-xs text-right text-slate-500">' + pct(r.fb_in_ats || 0, r.fb_leads || 0) + '</td>' +
      '<td class="px-2 py-2 text-xs text-right text-amber-700 font-semibold">' + fmtNum(r.fb_invited || 0) + '</td>' +
      '<td class="px-2 py-2 text-xs text-right text-slate-500">' + pct(r.fb_invited || 0, r.fb_in_ats || 0) + '</td>' +
      '<td class="px-2 py-2 text-xs text-right text-red-600">' + fmtNum(r.fb_contacted_fail || 0) + '</td>' +
      '<td class="px-2 py-2 text-xs text-right text-amber-600">' + fmtNum(r.fb_not_contacted || 0) + '</td>' +
      '<td class="px-2 py-2 text-xs text-right text-indigo-600">' + fmtNum(r.fb_pending_followup || 0) + '</td>' +
      '</tr>';
  }).join('');
  const html = '<table class="min-w-full text-sm"><thead class="bg-slate-50 sticky top-0"><tr>' +
    th('unit', '單位', 'text-left') +
    th('job_title', '職缺', 'text-left') +
    th('fb_spend', '花費', 'text-right') +
    th('fb_leads', 'Leads', 'text-right') +
    th('fb_cpl', 'CPL', 'text-right') +
    th('fb_in_ats', '進ATS', 'text-right') +
    '<th class="px-2 py-2 text-xs font-medium text-slate-600 text-right">進ATS率</th>' +
    th('fb_invited', '已邀約', 'text-right') +
    '<th class="px-2 py-2 text-xs font-medium text-slate-600 text-right">邀約率</th>' +
    th('fb_contacted_fail', '聯繫失敗', 'text-right') +
    th('fb_not_contacted', '未聯繫', 'text-right') +
    th('fb_pending_followup', '待跟進', 'text-right') +
    '</tr></thead><tbody>' + body + (rows.length ? totalRow : '') + '</tbody></table>';
  document.getElementById('funnel-byjob-table').innerHTML = rows.length ? html : emptyState('無職缺資料');
}

function sortFunnelByJob(key) {
  if (FUNNEL_BYJOB_SORT.key === key) FUNNEL_BYJOB_SORT.desc = !FUNNEL_BYJOB_SORT.desc;
  else FUNNEL_BYJOB_SORT = { key: key, desc: true };
  const view = computeFunnelView();
  renderFunnelByJob(view ? view.by_job : null);
}

function renderFunnelCampaigns(camps) {
  camps = camps || FUNNEL_DATA.fb_campaigns_raw || [];
  const sortKey = (document.getElementById('funnel-camp-sort') || {}).value || 'cpl_asc';
  const sorted = camps.slice().sort(function (a, b) {
    switch (sortKey) {
      case 'cpl_asc': return (a.cpl == null ? Infinity : a.cpl) - (b.cpl == null ? Infinity : b.cpl);
      case 'cpl_desc': return (b.cpl || 0) - (a.cpl || 0);
      case 'spend_desc': return (b.spend || 0) - (a.spend || 0);
      case 'leads_desc': return (b.leads || 0) - (a.leads || 0);
      default: return 0;
    }
  });
  const cTot = camps.reduce(function (a, c) {
    a.spend += c.spend || 0; a.leads += c.leads || 0; a.imp += c.impressions || 0;
    return a;
  }, { spend: 0, leads: 0, imp: 0 });
  const cTotCpl = cTot.leads ? cTot.spend / cTot.leads : 0;
  const cTotalRow = '<tr class="border-t-2 border-slate-300 bg-slate-100 font-bold">' +
    '<td class="px-2 py-2 text-xs" colspan="2">總計（' + camps.length + ' 波次）</td>' +
    '<td class="px-2 py-2 text-xs text-right text-rose-700">$' + fmtNum(Math.round(cTot.spend)) + '</td>' +
    '<td class="px-2 py-2 text-xs text-right">' + fmtNum(cTot.leads) + '</td>' +
    '<td class="px-2 py-2 text-xs text-right">$' + cTotCpl.toFixed(1) + '</td>' +
    '<td class="px-2 py-2 text-xs text-right text-slate-700">' + fmtNum(cTot.imp) + '</td>' +
    '<td class="px-2 py-2 text-xs text-right text-slate-500">-</td>' +
    '</tr>';
  const body = sorted.map(function (c) {
    const shared = c.related_jobs && c.related_jobs.length > 1;
    const sharedTag = shared ? '<span class="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">共用 ' + c.related_jobs.length + '</span>' : '';
    const cplCls = (c.cpl || 0) > 100 ? 'text-red-600 font-semibold' : 'text-slate-700';
    return '<tr class="border-t border-slate-100 hover:bg-slate-50">' +
      '<td class="px-2 py-2 text-xs text-slate-900">' + (c.campaign_name || '-') + sharedTag + '</td>' +
      '<td class="px-2 py-2 text-xs text-slate-500">' + (c.date_start || '') + ' ~ ' + (c.date_stop || '') + '</td>' +
      '<td class="px-2 py-2 text-xs text-right text-rose-600">$' + fmtNum(Math.round(c.spend || 0)) + '</td>' +
      '<td class="px-2 py-2 text-xs text-right font-semibold">' + fmtNum(c.leads || 0) + '</td>' +
      '<td class="px-2 py-2 text-xs text-right ' + cplCls + '">$' + (c.cpl || 0).toFixed(1) + '</td>' +
      '<td class="px-2 py-2 text-xs text-right text-slate-500">' + fmtNum(c.impressions || 0) + '</td>' +
      '<td class="px-2 py-2 text-xs text-right text-slate-500">' + (c.ctr || 0).toFixed(2) + '%</td>' +
      '</tr>';
  }).join('');
  const html = '<table class="min-w-full text-sm"><thead class="bg-slate-50 sticky top-0"><tr>' +
    '<th class="px-2 py-2 text-left text-xs font-medium text-slate-600">廣告名稱</th>' +
    '<th class="px-2 py-2 text-left text-xs font-medium text-slate-600">期間</th>' +
    '<th class="px-2 py-2 text-right text-xs font-medium text-slate-600">花費</th>' +
    '<th class="px-2 py-2 text-right text-xs font-medium text-slate-600">Leads</th>' +
    '<th class="px-2 py-2 text-right text-xs font-medium text-slate-600">CPL</th>' +
    '<th class="px-2 py-2 text-right text-xs font-medium text-slate-600">曝光</th>' +
    '<th class="px-2 py-2 text-right text-xs font-medium text-slate-600">CTR</th>' +
    '</tr></thead><tbody>' + body + (camps.length ? cTotalRow : '') + '</tbody></table>';
  document.getElementById('funnel-campaigns-table').innerHTML = camps.length ? html : emptyState('無廣告資料');
}

function renderFunnelPendingStats(pf) {
  pf = pf || FUNNEL_DATA.pending_followup || { total: 0, by_job: [] };
  const list = (pf.by_job || []).slice().sort(function (a, b) { return (b.count || 0) - (a.count || 0); });
  const total = pf.total || 0;
  const sumRow = '<tr class="border-t-2 border-slate-300 bg-slate-100 font-bold">' +
    '<td class="px-2 py-2 text-xs text-slate-900">總計</td>' +
    '<td class="px-2 py-2 text-xs text-right">' + fmtNum(total) + ' 人</td>' +
    '<td class="px-2 py-2 text-xs text-right text-slate-500">' + list.length + ' 個職缺</td>' +
    '</tr>';
  const body = list.map(function (j) {
    return '<tr class="border-t border-slate-100 hover:bg-slate-50">' +
      '<td class="px-2 py-2 text-xs">' + (j.job || '-') + '</td>' +
      '<td class="px-2 py-2 text-xs text-right font-semibold text-indigo-700">' + fmtNum(j.count || 0) + ' 人</td>' +
      '<td class="px-2 py-2 text-xs text-right text-slate-500">' + (total ? ((j.count || 0) / total * 100).toFixed(1) + '%' : '-') + '</td>' +
      '</tr>';
  }).join('');
  const html = '<table class="min-w-full text-sm"><thead class="bg-slate-50 sticky top-0"><tr>' +
    '<th class="px-2 py-2 text-left text-xs font-medium text-slate-600">職缺</th>' +
    '<th class="px-2 py-2 text-right text-xs font-medium text-slate-600">待跟進人數</th>' +
    '<th class="px-2 py-2 text-right text-xs font-medium text-slate-600">占比</th>' +
    '</tr></thead><tbody>' + body + (list.length ? sumRow : '') + '</tbody></table>';
  document.getElementById('funnel-pending-stats').innerHTML = list.length ? html : emptyState('本篩選條件下無待跟進資料');
}

// ========== Tab 切換 ==========
function switchTab(name) {
  const flowEls = document.querySelectorAll('.tab-content-flow');
  const chanEls = document.querySelectorAll('.tab-content-channel');
  const btnFlow = document.getElementById('tab-btn-flow');
  const btnChannel = document.getElementById('tab-btn-channel');
  const active = 'border-blue-600 text-blue-600';
  const inactive = 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300';
  if (name === 'channel') {
    flowEls.forEach(el => el.classList.add('hidden'));
    chanEls.forEach(el => el.classList.remove('hidden'));
    btnChannel.className = 'px-5 py-3 text-sm font-medium border-b-2 ' + active;
    btnFlow.className = 'px-5 py-3 text-sm font-medium border-b-2 ' + inactive;
    renderFunnelSection();
  } else {
    chanEls.forEach(el => el.classList.add('hidden'));
    flowEls.forEach(el => el.classList.remove('hidden'));
    btnFlow.className = 'px-5 py-3 text-sm font-medium border-b-2 ' + active;
    btnChannel.className = 'px-5 py-3 text-sm font-medium border-b-2 ' + inactive;
  }
}

// ========== 內部推薦管道 ==========
function renderReferralSection() {
  const sec = document.getElementById('section-referral');
  if (!sec) return;
  if (!REFERRAL_DATA) return;
  const p = REFERRAL_DATA.period || {};
  const dept = (document.getElementById('filter-dept') || {}).value || '';

  // 依部門篩選重算 summary（無篩選時用 producer summary）
  let s;
  if (dept) {
    const matched = (REFERRAL_DATA.by_dept || []).filter(x => x.dept === dept);
    s = {
      total_referrals: matched.reduce((a, x) => a + (x.referrals || 0), 0),
      in_ats: matched.reduce((a, x) => a + (x.in_ats || 0), 0),
      invited: matched.reduce((a, x) => a + (x.invited || 0), 0),
      hired: matched.reduce((a, x) => a + (x.hired || 0), 0),
      bonus_paid: matched.reduce((a, x) => a + (x.bonus_paid || 0), 0),
      bonus_pending: 0,
    };
  } else {
    s = REFERRAL_DATA.summary || {};
  }

  document.getElementById('ref-period').textContent =
    `區間：${p.start || '?'} ~ ${p.end || '?'}` + (dept ? `　|　🔍 已套用篩選（${dept}）` : '');
  const isEmpty = !(s.total_referrals > 0);
  document.getElementById('ref-empty-banner').classList.toggle('hidden', !isEmpty);

  document.getElementById('ref-referrals').textContent = fmtNum(s.total_referrals || 0);
  document.getElementById('ref-in-ats').textContent = fmtNum(s.in_ats || 0);
  document.getElementById('ref-invited').textContent = fmtNum(s.invited || 0);
  document.getElementById('ref-hired').textContent = fmtNum(s.hired || 0);
  document.getElementById('ref-bonus-paid').textContent = fmtNum(s.bonus_paid || 0);
  document.getElementById('ref-bonus-pending').textContent = fmtNum(s.bonus_pending || 0);

  const r = s.total_referrals || 0;
  document.getElementById('ref-in-ats-rate').textContent = r ? ((s.in_ats || 0) / r * 100).toFixed(1) + '% 入率' : '-';
  document.getElementById('ref-invited-rate').textContent = (s.in_ats || 0) ? ((s.invited || 0) / s.in_ats * 100).toFixed(1) + '%' : '-';
  document.getElementById('ref-hired-rate').textContent = r ? ((s.hired || 0) / r * 100).toFixed(1) + '%' : '-';
  document.getElementById('ref-bonus-per').textContent = (s.hired || 0) ? fmtNum(Math.round((s.bonus_paid || 0) / s.hired)) : '-';

  // 部門排行
  const byDept = (REFERRAL_DATA.by_dept || [])
    .filter(d => d.dept !== '請填入部門名')
    .sort((a, b) => (b.hired || 0) - (a.hired || 0));
  const deptBody = byDept.map(d => `
    <tr class="border-t border-slate-100 hover:bg-slate-50">
      <td class="px-3 py-2 text-sm">${d.dept}</td>
      <td class="px-3 py-2 text-sm text-right">${fmtNum(d.referrals || 0)}</td>
      <td class="px-3 py-2 text-sm text-right text-cyan-700">${fmtNum(d.in_ats || 0)}</td>
      <td class="px-3 py-2 text-sm text-right text-amber-700">${fmtNum(d.invited || 0)}</td>
      <td class="px-3 py-2 text-sm text-right font-semibold text-green-700">${fmtNum(d.hired || 0)}</td>
      <td class="px-3 py-2 text-sm text-right text-rose-600">$${fmtNum(d.bonus_paid || 0)}</td>
    </tr>
  `).join('');
  document.getElementById('ref-dept-table').innerHTML = `
    <table class="min-w-full text-sm">
      <thead class="bg-slate-50 sticky top-0">
        <tr>
          <th class="px-3 py-2 text-left text-xs font-medium text-slate-600">部門</th>
          <th class="px-3 py-2 text-right text-xs font-medium text-slate-600">推薦</th>
          <th class="px-3 py-2 text-right text-xs font-medium text-slate-600">進 ATS</th>
          <th class="px-3 py-2 text-right text-xs font-medium text-slate-600">已邀約</th>
          <th class="px-3 py-2 text-right text-xs font-medium text-slate-600">已報到</th>
          <th class="px-3 py-2 text-right text-xs font-medium text-slate-600">獎金</th>
        </tr>
      </thead>
      <tbody>${deptBody || '<tr><td colspan="6" class="p-4 text-center text-slate-400">尚無部門資料</td></tr>'}</tbody>
    </table>
  `;

  // 推薦人 Top 10
  const byRef = (REFERRAL_DATA.by_referrer || [])
    .filter(r => r.referrer && r.referrer !== '推薦人姓名（可選填）')
    .sort((a, b) => (b.hired_count || 0) - (a.hired_count || 0))
    .slice(0, 10);
  const refBody = byRef.map((u, i) => `
    <tr class="border-t border-slate-100 hover:bg-slate-50">
      <td class="px-2 py-2 text-xs text-slate-400 text-right">${i + 1}</td>
      <td class="px-3 py-2 text-sm font-medium">${u.referrer}</td>
      <td class="px-3 py-2 text-sm text-right">${fmtNum(u.referred_count || 0)}</td>
      <td class="px-3 py-2 text-sm text-right font-semibold text-green-700">${fmtNum(u.hired_count || 0)}</td>
      <td class="px-3 py-2 text-sm text-right text-rose-600">$${fmtNum(u.bonus_amount || 0)}</td>
    </tr>
  `).join('');
  document.getElementById('ref-referrer-table').innerHTML = `
    <table class="min-w-full text-sm">
      <thead class="bg-slate-50 sticky top-0">
        <tr>
          <th class="px-2 py-2 text-right text-xs font-medium text-slate-600">#</th>
          <th class="px-3 py-2 text-left text-xs font-medium text-slate-600">推薦人</th>
          <th class="px-3 py-2 text-right text-xs font-medium text-slate-600">推薦數</th>
          <th class="px-3 py-2 text-right text-xs font-medium text-slate-600">已報到</th>
          <th class="px-3 py-2 text-right text-xs font-medium text-slate-600">獎金</th>
        </tr>
      </thead>
      <tbody>${refBody || '<tr><td colspan="5" class="p-4 text-center text-slate-400">尚無推薦人資料</td></tr>'}</tbody>
    </table>
  `;

  renderReferralBonusDetails();
}

// 推薦獎金逐筆明細
function renderReferralBonusDetails() {
  const wrap = document.getElementById('ref-bonus-table');
  if (!wrap || !REFERRAL_DATA) return;
  const details = REFERRAL_DATA.bonus_details || [];
  const summary = REFERRAL_DATA.bonus_summary || {};
  document.getElementById('ref-bonus-eligible').textContent = summary.eligible_hires ?? '-';
  document.getElementById('ref-bonus-ineligible').textContent = summary.ineligible_hires ?? '-';
  document.getElementById('ref-bonus-m3').textContent = summary.milestones_3m_paid ?? '-';
  document.getElementById('ref-bonus-m6').textContent = summary.milestones_6m_paid ?? '-';

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const mileBadge = (mile) => {
    if (!mile) return '<span class="text-slate-300">—</span>';
    const minguo = mile.salary_month ? `<div class="text-[10px] text-slate-500">獎金月 ${mile.salary_month}</div>` : '';
    if (mile.paid) {
      return `<span class="inline-block px-2 py-0.5 rounded text-[11px] bg-emerald-100 text-emerald-700" title="滿月日 ${mile.milestone_date} → 薪資月 ${mile.salary_month} → ${mile.payday} 發">已發 $${fmtNum(mile.amount)}<div class="text-[10px] text-emerald-600">${mile.payday} 發</div>${minguo}</span>`;
    }
    return `<span class="inline-block px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-600" title="滿月日 ${mile.milestone_date} → 薪資月 ${mile.salary_month} → 待 ${mile.payday} 發">待 ${mile.payday}<div class="text-[10px] text-slate-400">滿月 ${mile.milestone_date}</div>${minguo}</span>`;
  };

  const rows = details.map(d => {
    if (!d.applicable) {
      return `<tr class="border-t border-slate-100 bg-slate-50">
        <td class="px-3 py-1.5 text-sm font-medium text-slate-500">${esc(d.name)}</td>
        <td class="px-3 py-1.5 text-sm text-slate-500">${esc(d.jobTitle)}</td>
        <td class="px-3 py-1.5 text-sm text-slate-500">${esc(d.dept)}</td>
        <td class="px-3 py-1.5 text-sm text-slate-500">${esc(d.referrer)}</td>
        <td class="px-3 py-1.5 text-sm text-slate-400 whitespace-nowrap">${esc(d.startDate)}</td>
        <td class="px-3 py-1.5 text-sm" colspan="2"><span class="text-xs text-slate-500">⊘ 不適用 — ${esc(d.reason_not_applicable)}</span></td>
        <td class="px-3 py-1.5 text-sm text-right text-slate-400">$0</td>
      </tr>`;
    }
    const total = d.paid + d.pending;
    const exTag = d.exception_note
      ? `<span class="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-fuchsia-100 text-fuchsia-700" title="${esc(d.exception_note)}">特例</span>`
      : '';
    const manTag = d.manual
      ? `<span class="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-blue-100 text-blue-700" title="未走 ATS 系統，HR 手動補登">手動補登</span>`
      : '';
    return `<tr class="border-t border-slate-100 hover:bg-emerald-50">
      <td class="px-3 py-1.5 text-sm font-medium">${esc(d.name)}${manTag}${exTag}</td>
      <td class="px-3 py-1.5 text-sm text-slate-700">${esc(d.jobTitle)}</td>
      <td class="px-3 py-1.5 text-sm text-slate-700">${esc(d.dept)}</td>
      <td class="px-3 py-1.5 text-sm">${esc(d.referrer)}</td>
      <td class="px-3 py-1.5 text-sm text-slate-600 whitespace-nowrap">${esc(d.startDate)}</td>
      <td class="px-3 py-1.5">${mileBadge(d.milestone_3m)}</td>
      <td class="px-3 py-1.5">${mileBadge(d.milestone_6m)}</td>
      <td class="px-3 py-1.5 text-sm text-right whitespace-nowrap">
        <span class="font-semibold text-rose-700">$${fmtNum(d.paid)}</span>
        <span class="text-[10px] text-slate-400">/ 待 $${fmtNum(d.pending)}</span>
      </td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `<table class="min-w-full text-sm">
    <thead class="bg-slate-50 sticky top-0">
      <tr class="text-xs text-slate-600">
        <th class="text-left px-3 py-2">姓名</th>
        <th class="text-left px-3 py-2">職缺</th>
        <th class="text-left px-3 py-2">部門</th>
        <th class="text-left px-3 py-2">推薦人</th>
        <th class="text-left px-3 py-2">入職日</th>
        <th class="text-left px-3 py-2">3 個月 ($3,000)</th>
        <th class="text-left px-3 py-2">6 個月 ($3,000)</th>
        <th class="text-right px-3 py-2">已發/待發</th>
      </tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="8" class="p-4 text-center text-slate-400">尚無已報到推薦案</td></tr>'}</tbody>
  </table>`;
}

// ========== 招募管道綜合評估 ==========
function renderChannelOverview() {
  const sec = document.getElementById('section-channel-overview');
  if (!sec) return;
  const src = FILTERED || DATA;
  const re = (src && src.recruitment_effectiveness) || {};
  const dept = (document.getElementById('filter-dept') || {}).value || '';
  const monthFrom = (document.getElementById('filter-month-from') || {}).value || (DATA?.meta?.year ? `${DATA.meta.year}-01` : '2026-01');
  const monthTo   = (document.getElementById('filter-month-to')   || {}).value || (DATA?.meta?.year ? `${DATA.meta.year}-12` : '2026-12');

  // 偵測 FB 資料是否異常（token 過期等）— 整段期間 leads + spend = 0 表示異常
  const fbBM = FUNNEL_DATA?.by_month || [];
  const fbAllZero = fbBM.length > 0
    && fbBM.every(m => (m.leads || 0) === 0 && (m.spend || 0) === 0);
  // 在區塊上方插入或移除警示
  const ovNote = document.getElementById('ov-note');
  if (ovNote) {
    if (fbAllZero) {
      ovNote.innerHTML = '<span class="text-amber-700">⚠ FB 廣告資料暫時無法取得（疑似 Meta API token 失效，等行銷團隊更新後自動補上）</span>';
    } else {
      ovNote.textContent = '';
    }
  }

  // 各管道資料蒐集
  const channels = [];

  // FB — 從 by_month / by_month_unit 依上方期間+部門篩選器動態加總
  if (FUNNEL_DATA && (FUNNEL_DATA.by_month || FUNNEL_DATA.by_month_unit)) {
    let matched;
    if (dept && FUNNEL_DATA.by_month_unit) {
      // 有 dept 篩選：用 by_month_unit + deptMatchesUnit 比對
      matched = FUNNEL_DATA.by_month_unit.filter(m =>
        m.month >= monthFrom && m.month <= monthTo && deptMatchesUnit(dept, m.unit)
      );
    } else {
      matched = (FUNNEL_DATA.by_month || []).filter(m => m.month >= monthFrom && m.month <= monthTo);
    }
    if (matched.length === 0) {
      channels.push({
        name: 'FB 廣告', icon: '📣', color: 'rose',
        spend: 0, leads: null, in_ats: null, invited: null, hired: null,
        period: `${monthFrom} ~ ${monthTo}` + (dept ? ` (${dept})` : ''),
        coverageNote: dept ? `${dept} 本期間無 FB 廣告` : '本期間無 FB 廣告資料',
        noData: true,
      });
    } else {
      const sum = matched.reduce((s, m) => ({
        leads: s.leads + (m.leads || 0),
        spend: s.spend + (m.spend || 0),
        in_ats: s.in_ats + (m.in_ats || 0),
        invited: s.invited + (m.invited || 0),
        hired: s.hired + (m.hired || 0),
      }), {leads: 0, spend: 0, in_ats: 0, invited: 0, hired: 0});
      const months = [...new Set(matched.map(m => m.month))].sort();
      const actualFrom = months[0];
      const actualTo = months[months.length-1];
      const fullCover = (actualFrom === monthFrom && actualTo === monthTo);
      // FB 跨管道轉投人數（FB lead → 改投 104/1111/website 的 phone 末9碼比中數）
      let ccTotal = 0, ccInvited = 0, ccHired = 0, ccBySrc = {};
      const ccArr = FUNNEL_DATA.fb_cross_channel?.by_source_month || [];
      ccArr.filter(x => {
        const m = x.in_month || '';
        return m >= monthFrom && m <= monthTo;
      }).forEach(x => {
        ccTotal++;
        if (x.invited) ccInvited++;
        if (x.hired) ccHired++;
        ccBySrc[x.src] = (ccBySrc[x.src] || 0) + 1;
      });
      channels.push({
        name: 'FB 廣告', icon: '📣', color: 'rose',
        spend: sum.spend,
        leads: sum.leads,
        in_ats: sum.in_ats,
        invited: sum.invited,
        hired: sum.hired,  // 0 也要顯示，不要轉 null
        period: `${monthFrom} ~ ${monthTo}` + (dept ? ` (${dept})` : ''),
        coverageNote: fullCover ? null : `實際資料涵蓋 ${actualFrom} ~ ${actualTo}`,
        extraInfo: ccTotal > 0
          ? `🔄 含跨管道 ${ccTotal} (104:${ccBySrc['104']||0}/1111:${ccBySrc['1111']||0}/官網:${ccBySrc['website']||0}) → 邀 ${ccInvited} / 報 ${ccHired}`
          : null,
      });
    }
  }

  // 104 / 1111 — 從 by_week 依上方期間篩選器動態加總
  // 投入金額：年費月平均攤提（年費 / 12 × 該期間月數）
  const channelCosts = re.channel_costs || {};
  // 計算篩選期間月數 (含頭尾)
  const [fy, fm] = monthFrom.split('-').map(Number);
  const [ty, tm] = monthTo.split('-').map(Number);
  const periodMonthCount = Math.max(1, (ty - fy) * 12 + (tm - fm) + 1);

  // 從 channel_intake (ATS source 反推) 取進 ATS / 邀約 / 報到（按月+部門）
  const channelIntakeAll = re.channel_intake?.by_source_month_dept || [];
  const aggregateIntake = (sourceKey) => {
    const matched = channelIntakeAll.filter(x =>
      x.source === sourceKey
      && x.month >= monthFrom && x.month <= monthTo
      && (!dept || x.dept === dept)
    );
    return matched.reduce((s, x) => ({
      in_ats:  s.in_ats  + (x.in_ats  || 0),
      invited: s.invited + (x.invited || 0),
      hired:   s.hired   + (x.hired   || 0),
    }), {in_ats: 0, invited: 0, hired: 0});
  };

  const aggregateWeekly = (data, name, icon, color, costKey, intakeKey) => {
    if (!data || !data.by_week) return;
    const fromDate = monthFrom + '-01';
    const lastDay = new Date(ty, tm, 0).getDate();
    const toDate = `${monthTo}-${String(lastDay).padStart(2, '0')}`;
    const matched = data.by_week.filter(w =>
      w.week_end >= fromDate && w.week_start <= toDate
    );
    // ATS 漏斗（從 channel_intake 取）
    const intake = intakeKey ? aggregateIntake(intakeKey) : {in_ats: null, invited: null, hired: null};
    // 年費月攤提（不論該期間有沒有週報資料，年費都在跑）
    // 有 dept 篩選時：按該 dept 在該管道的 in_ats 比例分攤年費；無篩選用全額
    const annualFee = (channelCosts[costKey] || {}).annual_fee || 0;
    let amortizedSpend = annualFee ? Math.round(annualFee / 12 * periodMonthCount) : 0;
    if (dept && intakeKey && amortizedSpend > 0) {
      // 全公司同期 in_ats 加總
      const allIn = channelIntakeAll
        .filter(x => x.source === intakeKey && x.month >= monthFrom && x.month <= monthTo)
        .reduce((s, x) => s + (x.in_ats || 0), 0);
      const ratio = allIn > 0 ? (intake.in_ats / allIn) : 0;
      amortizedSpend = Math.round(amortizedSpend * ratio);
    }
    const dataStartMonth = data.data_range_start ? data.data_range_start.slice(0, 7) : null;

    if (matched.length === 0) {
      channels.push({
        name, icon, color,
        spend: amortizedSpend, leads: null,
        in_ats: intake.in_ats || null, invited: intake.invited || null, hired: intake.hired || null,
        pv: null, jobCount: null,
        period: `${monthFrom} ~ ${monthTo}`,
        coverageNote: dataStartMonth ? `本期間無週報（資料起始 ${dataStartMonth}）` : '本期間無週報',
        noData: !intake.in_ats && !intake.invited && !intake.hired,
        spendNote: amortizedSpend ? `年費 $${fmtNum(annualFee)} × ${periodMonthCount}/12 月` : null,
      });
      return;
    }
    let pv = 0, app = 0, jobCount = 0;
    matched.forEach(w => {
      if (dept) {
        const dm = (w.departments || []).filter(x => x.dept === dept);
        pv += dm.reduce((s, x) => s + (x.total_pv || 0), 0);
        app += dm.reduce((s, x) => s + (x.total_app || 0), 0);
        jobCount += dm.reduce((s, x) => s + (x.job_count || 0), 0);
      } else {
        pv += w.total_pv || 0;
        app += w.total_app || 0;
        jobCount += w.total_active_jobs || 0;
      }
    });
    const periodStart = matched[0].week_start;
    const periodEnd = matched[matched.length - 1].week_end;
    channels.push({
      name, icon, color,
      spend: amortizedSpend,
      leads: app,
      in_ats: intake.in_ats, invited: intake.invited, hired: intake.hired,
      pv: pv,
      jobCount: jobCount,
      period: `${monthFrom} ~ ${monthTo}` + (dept ? ` ${dept}` : ''),
      coverageNote: `實際資料涵蓋 ${periodStart} ~ ${periodEnd} (${matched.length} 週報)`,
      spendNote: amortizedSpend
        ? (dept ? `年費 $${fmtNum(annualFee)} × ${periodMonthCount}/12 月 × ${dept} 進ATS 比例`
                : `年費 $${fmtNum(annualFee)} × ${periodMonthCount}/12 月`)
        : null,
      dataStartNote: dataStartMonth && dataStartMonth > monthFrom ? `資料起始 ${dataStartMonth}` : null,
    });
  };
  aggregateWeekly(re.weekly_104,  '104 人力銀行',  '🔵', 'blue',   '104',  '104');
  aggregateWeekly(re.weekly_1111, '1111 人力銀行', '🟣', 'purple', '1111', '1111');

  // 內部推薦 — 從 by_month / by_month_dept 依上方期間+部門篩選器動態加總
  if (REFERRAL_DATA && (REFERRAL_DATA.by_month || REFERRAL_DATA.by_month_dept)) {
    let matched;
    if (dept && REFERRAL_DATA.by_month_dept) {
      matched = REFERRAL_DATA.by_month_dept.filter(m =>
        m.month >= monthFrom && m.month <= monthTo && m.dept === dept
      );
    } else {
      matched = (REFERRAL_DATA.by_month || []).filter(m => m.month >= monthFrom && m.month <= monthTo);
    }
    if (matched.length === 0) {
      channels.push({
        name: '內部推薦', icon: '🤝', color: 'emerald',
        spend: 0, leads: null, in_ats: null, invited: null, hired: null,
        period: `${monthFrom} ~ ${monthTo}` + (dept ? ` (${dept})` : ''),
        coverageNote: dept ? `${dept} 本期間無推薦案` : '本期間無推薦案',
        noData: true,
      });
    } else {
      const sum = matched.reduce((s, m) => ({
        referrals: s.referrals + (m.referrals || 0),
        in_ats: s.in_ats + (m.in_ats || 0),
        invited: s.invited + (m.invited || 0),
        hired: s.hired + (m.hired || 0),
      }), {referrals: 0, in_ats: 0, invited: 0, hired: 0});
      const months = [...new Set(matched.map(m => m.month))].sort();
      const actualFrom = months[0];
      const actualTo = months[months.length-1];
      const fullCover = (actualFrom === monthFrom && actualTo === monthTo);
      // 推薦獎金成本（已發 + 待發）— 依期間篩選 bonus_details 的 startDate
      let bonusPaid = 0, bonusPending = 0;
      (REFERRAL_DATA.bonus_details || []).forEach(b => {
        const m = (b.startDate || '').slice(0, 7);
        if (!m || m < monthFrom || m > monthTo) return;
        if (dept && b.dept !== dept) return;
        bonusPaid += (b.paid || 0);
        bonusPending += (b.pending || 0);
      });
      channels.push({
        name: '內部推薦', icon: '🤝', color: 'emerald',
        spend: bonusPaid,  // 已實際發放的獎金 = 真實投入
        bonusPending: bonusPending,
        leads: sum.referrals,
        in_ats: sum.in_ats,
        invited: sum.invited,
        hired: sum.hired,
        period: `${monthFrom} ~ ${monthTo}` + (dept ? ` (${dept})` : ''),
        coverageNote: fullCover ? null : `實際資料涵蓋 ${actualFrom} ~ ${actualTo}`,
        extraInfo: bonusPending > 0 ? `💰 已發 $${fmtNum(bonusPaid)} / 待發 $${fmtNum(bonusPending)}（3+6 個月分段）` : null,
        spendNote: bonusPaid > 0 ? '推薦獎金已發放金額（達門檻後次月發薪）' : null,
      });
    }
  }

  // === 資料覆蓋率（用 K 槽達成率 Excel 為真實基準）===
  // 部門篩選時改用 persons[] 按 dept filter 加總；無篩選時用 by_month_hires
  let periodHires = 0;
  const ach = re.achievement;
  if (ach) {
    if (dept && Array.isArray(ach.persons)) {
      periodHires = ach.persons.filter(p => {
        const m = (p.start_date || '').slice(0, 7);
        return m >= monthFrom && m <= monthTo && p.dept === dept;
      }).length;
    } else if (Array.isArray(ach.by_month_hires)) {
      periodHires = ach.by_month_hires
        .filter(m => m.month >= monthFrom && m.month <= monthTo)
        .reduce((s, m) => s + (m.hires || 0), 0);
    }
  }
  const trackedHires = channels.reduce((s, c) => s + (c.hired || 0), 0);

  // 卡片
  const cardsEl = document.getElementById('ov-channel-cards');
  cardsEl.innerHTML = channels.map(c => {
    const cpl = c.leads ? Math.round((c.spend || 0) / c.leads) : 0;
    const costPerHire = c.hired ? Math.round((c.spend || 0) / c.hired) : null;
    const colorMap = {
      rose: ['bg-rose-50', 'border-rose-200', 'text-rose-700'],
      blue: ['bg-blue-50', 'border-blue-200', 'text-blue-700'],
      purple: ['bg-purple-50', 'border-purple-200', 'text-purple-700'],
      emerald: ['bg-emerald-50', 'border-emerald-200', 'text-emerald-700'],
      slate: ['bg-slate-50', 'border-slate-300', 'text-slate-700'],
    };
    const [bg, br, tc] = colorMap[c.color] || colorMap.blue;
    const spendInfo = c.spendNote ? `title="${c.spendNote}"` : '';
    const dataStartTag = c.dataStartNote ? `<div class="text-[10px] text-amber-700 mt-1">⚠ ${c.dataStartNote}</div>` : '';
    const coverageTag = c.coverageNote ? `<div class="text-[10px] text-slate-500 mt-1">${c.coverageNote}</div>` : '';
    const extraInfoTag = c.extraInfo ? `<div class="text-[10px] text-fuchsia-700 mt-1 font-medium bg-fuchsia-50 px-2 py-1 rounded">${c.extraInfo}</div>` : '';
    const spendIcon = c.spendNote ? '<span class="text-slate-400 cursor-help">ⓘ</span>' : '';
    return `
      <div class="${bg} border ${br} rounded-lg p-4">
        <div class="flex items-center justify-between mb-2">
          <div class="text-sm font-semibold ${tc} flex items-center gap-1">
            <span>${c.icon}</span>${c.name}
          </div>
          <span class="text-[10px] text-slate-500">${c.period}</span>
        </div>
        <div class="grid grid-cols-2 gap-2 text-xs">
          <div ${spendInfo}><span class="text-slate-500">投入 ${spendIcon}</span><div class="font-bold ${tc}">${(c.spend || 0) > 0 ? '$' + fmtNum(Math.round(c.spend)) : (c.noData && !c.spendNote ? '—' : '$0')}</div></div>
          <div><span class="text-slate-500">履歷/Leads</span><div class="font-bold ${tc}">${c.leads == null ? '—' : fmtNum(c.leads)}</div></div>
          <div><span class="text-slate-500">進 ATS</span><div class="font-bold">${c.in_ats == null ? '—' : fmtNum(c.in_ats)}</div></div>
          <div><span class="text-slate-500">已邀約</span><div class="font-bold">${c.invited == null ? '—' : fmtNum(c.invited)}</div></div>
          <div><span class="text-slate-500">已報到</span><div class="font-bold text-green-700">${c.hired == null ? '—' : fmtNum(c.hired)}</div></div>
          <div><span class="text-slate-500">CPL</span><div class="font-bold">${cpl ? '$' + fmtNum(cpl) : '—'}</div></div>
        </div>
        ${extraInfoTag}
        ${coverageTag}
        ${dataStartTag}
      </div>
    `;
  }).join('');

  // 表格
  const tbody = document.getElementById('ov-channel-table');
  tbody.innerHTML = channels.map(c => {
    const cpl = c.leads ? Math.round((c.spend || 0) / c.leads) : 0;
    const cph = c.hired ? Math.round((c.spend || 0) / c.hired) : null;
    return `
      <tr class="border-t border-slate-100 hover:bg-slate-50">
        <td class="px-3 py-2 text-sm font-medium">${c.icon} ${c.name}</td>
        <td class="px-3 py-2 text-sm text-right text-rose-600">${(c.spend || 0) > 0 ? '$' + fmtNum(Math.round(c.spend)) : (c.noData ? '—' : '$0')}</td>
        <td class="px-3 py-2 text-sm text-right font-semibold">${c.leads == null ? '—' : fmtNum(c.leads)}</td>
        <td class="px-3 py-2 text-sm text-right text-cyan-700">${c.in_ats == null ? '—' : fmtNum(c.in_ats)}</td>
        <td class="px-3 py-2 text-sm text-right text-amber-700">${c.invited == null ? '—' : fmtNum(c.invited)}</td>
        <td class="px-3 py-2 text-sm text-right font-bold text-green-700">${c.hired == null ? '—' : fmtNum(c.hired)}</td>
        <td class="px-3 py-2 text-sm text-right">${cpl ? '$' + fmtNum(cpl) : '—'}</td>
        <td class="px-3 py-2 text-sm text-right text-purple-700">${cph ? '$' + fmtNum(cph) : '—'}</td>
      </tr>
    `;
  }).join('') + (() => {
    // 總計列
    const tot = channels.reduce((a, c) => {
      a.spend += c.spend || 0;
      a.leads += c.leads || 0;
      a.in_ats += c.in_ats || 0;
      a.invited += c.invited || 0;
      a.hired += c.hired || 0;
      return a;
    }, { spend: 0, leads: 0, in_ats: 0, invited: 0, hired: 0 });
    const totCpl = tot.leads ? Math.round(tot.spend / tot.leads) : 0;
    const totCph = tot.hired ? Math.round(tot.spend / tot.hired) : 0;
    return `
      <tr class="border-t-2 border-slate-300 bg-slate-100 font-bold">
        <td class="px-3 py-2 text-sm">總計（${channels.length} 管道）</td>
        <td class="px-3 py-2 text-sm text-right text-rose-700">$${fmtNum(Math.round(tot.spend))}</td>
        <td class="px-3 py-2 text-sm text-right">${fmtNum(tot.leads)}</td>
        <td class="px-3 py-2 text-sm text-right text-cyan-800">${fmtNum(tot.in_ats)}</td>
        <td class="px-3 py-2 text-sm text-right text-amber-800">${fmtNum(tot.invited)}</td>
        <td class="px-3 py-2 text-sm text-right text-green-800">${fmtNum(tot.hired)}</td>
        <td class="px-3 py-2 text-sm text-right">${totCpl ? '$' + fmtNum(totCpl) : '—'}</td>
        <td class="px-3 py-2 text-sm text-right text-purple-800">${totCph ? '$' + fmtNum(totCph) : '—'}</td>
      </tr>
    `;
  })();

  // 圖表
  renderOvAppsChart(channels);
  renderOvCplChart(channels);

  // 全期間 × 全管道 統計總結
  const totSpend = channels.reduce((s, c) => s + (c.spend || 0), 0);
  const totLeads = channels.reduce((s, c) => s + (c.leads || 0), 0);
  const totInAts = channels.reduce((s, c) => s + (c.in_ats || 0), 0);
  const totInvited = channels.reduce((s, c) => s + (c.invited || 0), 0);
  const totHired = channels.reduce((s, c) => s + (c.hired || 0), 0);
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText('ov-tot-spend', fmtNum(Math.round(totSpend)));
  setText('ov-tot-leads', fmtNum(totLeads));
  setText('ov-tot-inats', fmtNum(totInAts));
  setText('ov-tot-invited', fmtNum(totInvited));
  setText('ov-tot-hired', fmtNum(totHired));
  setText('ov-rate', totInAts > 0 ? (totHired / totInAts * 100).toFixed(1) + '%' : '—');
  setText('ov-cph', totHired > 0 ? fmtNum(Math.round(totSpend / totHired)) : '—');

  // note + 資料覆蓋率
  const noteEl = document.getElementById('ov-note');
  if (periodHires > 0) {
    const covPct = ((trackedHires / periodHires) * 100).toFixed(0);
    const covColor = covPct >= 70 ? 'text-emerald-700' : (covPct >= 40 ? 'text-amber-700' : 'text-rose-700');
    noteEl.innerHTML = `管道數：${channels.length}　|　<span class="${covColor}">資料覆蓋率 ${covPct}% (${trackedHires}/${periodHires})</span>`;
  } else {
    noteEl.textContent = '管道數：' + channels.length;
  }
}

function renderOvAppsChart(channels) {
  destroyChart('ovApps');
  const ctx = document.getElementById('chart-ov-apps');
  if (!ctx) return;
  const colors = { 'FB 廣告': '#ef4444', '104 人力銀行': '#3b82f6', '1111 人力銀行': '#a855f7', '內部推薦': '#10b981' };
  CHARTS.ovApps = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: channels.map(c => c.name),
      datasets: [{
        label: '履歷／Leads',
        data: channels.map(c => c.leads),
        backgroundColor: channels.map(c => colors[c.name] || '#94a3b8'),
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

function renderOvCplChart(channels) {
  destroyChart('ovCpl');
  const ctx = document.getElementById('chart-ov-cpl');
  if (!ctx) return;
  const colors = { 'FB 廣告': '#ef4444', '104 人力銀行': '#3b82f6', '1111 人力銀行': '#a855f7', '內部推薦': '#10b981' };
  const data = channels.map(c => c.leads ? Math.round((c.spend || 0) / c.leads) : 0);
  CHARTS.ovCpl = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: channels.map(c => c.name),
      datasets: [{
        label: '每筆 CPL',
        data: data,
        backgroundColor: channels.map(c => colors[c.name] || '#94a3b8'),
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => ` $${fmtNum(c.parsed.y)} / 筆` } }
      },
      scales: { y: { beginAtZero: true, ticks: { callback: (v) => '$' + v } } }
    }
  });
}
