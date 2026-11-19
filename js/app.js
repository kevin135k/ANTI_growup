import { GROWTH_TABLE, GRADE_MAP } from './data/growthData.js';
import { BMI_TABLE } from './data/bmiData.js';
import { DEV_MILESTONES, QUICK_REF_BY_AGE } from './data/clinicalData.js';
import {
  parseBirthdayInput,
  calculateAge,
  evaluateGrowthMetric,
  evaluateBMI,
  calculateTargetHeight,
  projectAdultHeight,
  predictHeightByBoneAge,
  evaluateBirthWeight
} from './calc/growthEngine.js';
import { renderGrowthChartSVG } from './ui/chartRenderer.js';

const SCALE_STEPS = [0.85, 0.92, 1.0, 1.1, 1.2, 1.3];
const TAB_TITLES = {
  'height-predict': '預測身高與生長評估',
  'sga-newborn': '新生兒 SGA / 胎齡評估',
  'dev-screen': '兒童發展評估篩檢',
  'ref-tables': '台灣身高體重與 BMI 對照表',
  'quick-ref': '兒科門診速查參考'
};

const state = {
  sex: 'girl',
  activeTab: 'height-predict',
  chartMetric: 'h',
  scaleIndex: 2, // 1.0 (100%)
  birthdayParsed: null,
  ageInfo: null,
  heightCm: null,
  weightKg: null,
  fatherCm: null,
  motherCm: null,
  boneAgeY: null,
  boneAgeM: null,
  boneAgeH: null,
  hcCm: null,
  pretermGA: null,
  sgaPlurality: 'singleton',
  sgaGA: null,
  sgaWeightG: null,
  refTableKey: 'girl-h',
  devBandId: '24m',
  devAnswers: {} // { '24m-0': 'pass' | 'fail' | 'skip' }
};

const $ = (id) => document.getElementById(id);

function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ==========================================================================
   UI Scale (+ / - in Hamburger Menu)
   ========================================================================== */
function loadSavedScale() {
  try {
    const saved = localStorage.getItem('anti_growup_scale_idx');
    if (saved !== null) {
      const idx = parseInt(saved, 10);
      if (idx >= 0 && idx < SCALE_STEPS.length) {
        state.scaleIndex = idx;
      }
    }
  } catch (_) {}
  applyScale();
}

function applyScale() {
  const val = SCALE_STEPS[state.scaleIndex];
  document.documentElement.style.setProperty('--ui-scale', String(val));
  $('scaleLabel').textContent = `${Math.round(val * 100)}%`;
  $('scaleDownBtn').disabled = state.scaleIndex <= 0;
  $('scaleUpBtn').disabled = state.scaleIndex >= SCALE_STEPS.length - 1;
  try {
    localStorage.setItem('anti_growup_scale_idx', String(state.scaleIndex));
  } catch (_) {}
}

/* ==========================================================================
   Drawer & Tab Navigation
   ========================================================================== */
function openDrawer() {
  $('appDrawer').classList.add('open');
  $('drawerBackdrop').classList.add('open');
  $('menuOpenBtn').setAttribute('aria-expanded', 'true');
  $('drawerBackdrop').setAttribute('aria-hidden', 'false');
}

function closeDrawer() {
  $('appDrawer').classList.remove('open');
  $('drawerBackdrop').classList.remove('open');
  $('menuOpenBtn').setAttribute('aria-expanded', 'false');
  $('drawerBackdrop').setAttribute('aria-hidden', 'true');
}

function switchTab(tabId) {
  state.activeTab = tabId;
  document.querySelectorAll('.tab-panel').forEach((p) => {
    p.classList.toggle('active', p.id === `tab-${tabId}`);
  });
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  $('topbarTitle').textContent = TAB_TITLES[tabId] || '兒童生長曲線';
  closeDrawer();

  if (tabId === 'ref-tables') renderReferenceTable();
  if (tabId === 'dev-screen') renderDevScreening();
  if (tabId === 'quick-ref') renderQuickReference();
  if (tabId === 'sga-newborn') renderSGA();
}

/* ==========================================================================
   Sex Switcher
   ========================================================================== */
function setSex(sex) {
  state.sex = sex;
  document.documentElement.setAttribute('data-sex', sex);
  document.querySelectorAll('.sex-btn').forEach((btn) => {
    const active = btn.dataset.sex === sex;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  const sexLabel = sex === 'boy' ? '男孩' : '女孩';
  $('currentSexTag').textContent = sexLabel;
  $('sgaSexLabel').textContent = sexLabel;

  // Keep reference table sex aligned if currently viewing height/weight
  if (state.refTableKey !== 'bmi') {
    const suffix = state.refTableKey.endsWith('-w') ? '-w' : '-h';
    state.refTableKey = `${sex}${suffix}`;
    updateRefTableButtons();
  }
  recalculateAll();
}

/* ==========================================================================
   Effective Age Helper (uses Corrected Age for preterm < 37w & < 2.5y)
   ========================================================================== */
function getEffectiveAgeYears() {
  if (!state.ageInfo || state.ageInfo.error) return null;
  return state.ageInfo.corrected ? state.ageInfo.corrected.ageYears : state.ageInfo.ageYears;
}

/* ==========================================================================
   Main Recalculation (Prediction + Metrics + Chart + Secondary Tabs)
   ========================================================================== */
function recalculateAll() {
  const effectiveAge = getEffectiveAgeYears();
  const hEval =
    effectiveAge !== null && state.heightCm
      ? evaluateGrowthMetric(state.sex, effectiveAge, state.heightCm, 'h')
      : null;
  const wEval =
    effectiveAge !== null && state.weightKg
      ? evaluateGrowthMetric(state.sex, effectiveAge, state.weightKg, 'w')
      : null;
  const bmiEval =
    effectiveAge !== null && state.heightCm && state.weightKg
      ? evaluateBMI(state.sex, effectiveAge, state.heightCm, state.weightKg)
      : null;
  const hcEval =
    effectiveAge !== null && state.hcCm
      ? evaluateGrowthMetric(state.sex, effectiveAge, state.hcCm, 'hc')
      : null;

  const targetH = calculateTargetHeight(state.sex, state.fatherCm, state.motherCm);
  const projectedH = projectAdultHeight(state.sex, hEval);

  // Bone age prediction
  let boneAgePred = null;
  if (Number.isFinite(state.boneAgeY) && state.boneAgeY > 0) {
    const baTotal = state.boneAgeY + (Number.isFinite(state.boneAgeM) ? state.boneAgeM / 12 : 0);
    const examH = state.boneAgeH || state.heightCm;
    if (examH) {
      boneAgePred = predictHeightByBoneAge(state.sex, baTotal, examH, effectiveAge);
    }
  }

  // 1. Update Age Pill
  const agePill = $('ageDisplayPill');
  if (!state.birthdayParsed) {
    agePill.classList.remove('error');
    const rawText = $('birthdayText').value.trim();
    if (rawText.length >= 6) {
      agePill.classList.add('error');
      agePill.innerHTML = '<span>日期格式無法辨識（請輸入例：20180512 或 1070512）</span>';
    } else {
      agePill.innerHTML = '<span>請輸入生日以自動計算精確年齡</span>';
    }
  } else if (state.ageInfo?.error) {
    agePill.classList.add('error');
    agePill.innerHTML = `<span>${state.ageInfo.error}</span>`;
  } else {
    agePill.classList.remove('error');
    const corrHtml = state.ageInfo.corrected
      ? `<span>｜<strong>矯正年齡：${state.ageInfo.corrected.label}</strong></span>`
      : '';
    agePill.innerHTML = `
      <span>年齡：<strong>${state.ageInfo.label}</strong>（${state.ageInfo.ageYears.toFixed(2)} 歲）${corrHtml}</span>
      <span>${state.birthdayParsed.displayROC}</span>
    `;
  }

  // 2. Update Prediction Hero
  if (targetH) {
    $('targetHeightVal').innerHTML = `${targetH.mid.toFixed(1)}<span class="pred-unit">cm</span>`;
    $('targetHeightSub').textContent = `常見區間 ${targetH.low5.toFixed(1)}–${targetH.high5.toFixed(
      1
    )} cm（±7.5 cm：${targetH.low75.toFixed(1)}–${targetH.high75.toFixed(
      1
    )} cm）｜約成年 PR ${targetH.adultPercentile.toFixed(0)}`;
  } else {
    $('targetHeightVal').innerHTML = `--<span class="pred-unit">cm</span>`;
    $('targetHeightSub').textContent = '請輸入父高與母高以計算遺傳目標身高';
  }

  if (projectedH) {
    $('projectedHeightVal').innerHTML = `${projectedH.projected.toFixed(1)}<span class="pred-unit">cm</span>`;
    $('projectedHeightSub').textContent = `沿目前身高軌道（PR ${projectedH.percentile.toFixed(
      1
    )}，Z = ${projectedH.zScore >= 0 ? '+' : ''}${projectedH.zScore.toFixed(2)}）推估至 18 歲`;
  } else {
    $('projectedHeightVal').innerHTML = `--<span class="pred-unit">cm</span>`;
    $('projectedHeightSub').textContent = '請輸入生日與目前身高';
  }

  // Bone age result box
  const baBox = $('boneAgeResultBox');
  if (boneAgePred && boneAgePred.primaryProjected) {
    baBox.style.display = 'block';
    $('boneAgePredVal').innerHTML = `${boneAgePred.primaryProjected.toFixed(1)}<span class="pred-unit">cm</span>`;
    const parts = [];
    if (boneAgePred.bpProjected) {
      parts.push(`Bayley-Pinneau 比例法：${boneAgePred.bpProjected.toFixed(1)} cm（成熟度 ${boneAgePred.maturePct.toFixed(1)}%）`);
    }
    if (boneAgePred.curveProjected) {
      parts.push(`台灣骨齡曲線推估：${boneAgePred.curveProjected.toFixed(1)} cm`);
    }
    if (boneAgePred.baStatusText) {
      parts.push(boneAgePred.baStatusText);
    }
    $('boneAgePredSub').textContent = parts.join(' ｜ ');
  } else {
    baBox.style.display = 'none';
  }

  // Plain-language clinic interpretation for parents
  const noteEl = $('clinicInterpretation');
  const notes = [];
  if (hEval && hEval.percentile < 3) {
    notes.push('目前身高低於第 3 百分位（PR < 3），建議由兒童內分泌科評估生長速度與骨齡。');
  }
  if (targetH && projectedH) {
    const diff = projectedH.projected - targetH.mid;
    if (Math.abs(diff) <= 5) {
      notes.push(`目前曲線推估身高與遺傳目標身高相差 ${Math.abs(diff).toFixed(1)} cm，落於理想遺傳潛力區間內。`);
    } else if (diff < -5) {
      notes.push(`目前曲線推估較遺傳目標身高低 ${Math.abs(diff).toFixed(1)} cm，建議持續每 3–6 個月追蹤身高成長速度（學齡期每年應 ≥ 4–5 cm）。`);
    } else {
      notes.push(`目前曲線推估高於遺傳目標身高 ${diff.toFixed(1)} cm；若短期抽高過快，可留意是否提前進入青春期。`);
    }
  }
  if (bmiEval && (bmiEval.category === '過重' || bmiEval.category === '肥胖')) {
    notes.push(`目前 BMI 屬「${bmiEval.category}」，建議搭配均衡飲食與規律運動（體重過重亦可能加速骨齡成熟）。`);
  }
  if (notes.length > 0) {
    noteEl.style.display = 'block';
    noteEl.textContent = notes.join(' ');
  } else {
    noteEl.style.display = 'none';
  }

  // 3. Update Height / Weight / BMI / HC Metric Cards
  renderMetricCard({
    evalObj: hEval,
    valId: 'heightPRVal',
    metaId: 'heightMeta',
    badgeId: 'heightBadge',
    dotId: 'heightPrDot',
    unit: 'cm',
    emptyText: '輸入生日與身高顯示'
  });

  renderMetricCard({
    evalObj: wEval,
    valId: 'weightPRVal',
    metaId: 'weightMeta',
    badgeId: 'weightBadge',
    dotId: 'weightPrDot',
    unit: 'kg',
    emptyText: '輸入生日與體重顯示'
  });

  if (bmiEval) {
    $('bmiVal').textContent = bmiEval.bmi.toFixed(1);
    $('bmiMeta').textContent = `同齡正常範圍：${bmiEval.normalRangeText}`;
    const bBadge = $('bmiBadge');
    bBadge.style.display = 'inline-flex';
    bBadge.className = `badge ${bmiEval.status}`;
    bBadge.textContent = bmiEval.category;
  } else {
    $('bmiVal').textContent = '--';
    $('bmiMeta').textContent = '依衛福部兒童建議值判讀';
    $('bmiBadge').style.display = 'none';
  }

  // Optional Head Circumference Card
  const hcCard = $('hcMetricCard');
  if (hcEval) {
    hcCard.style.display = 'block';
    if (hcEval.outOfRange) {
      $('hcPRVal').textContent = '—';
      $('hcMeta').textContent = hcEval.message;
      $('hcBadge').style.display = 'none';
    } else {
      $('hcPRVal').textContent = `PR ${hcEval.percentile.toFixed(1)}`;
      $('hcMeta').textContent = `中位數 P50：${hcEval.p50.toFixed(1)} cm（P3–P97：${hcEval.p3.toFixed(1)}–${hcEval.p97.toFixed(1)}）`;
      const hcBadge = $('hcBadge');
      hcBadge.style.display = 'inline-flex';
      hcBadge.className = `badge ${hcEval.status}`;
      hcBadge.textContent = hcEval.badge;
    }
  } else {
    hcCard.style.display = 'none';
  }

  // 4. Update persistent Drawer Summary & Render Growth Charts (Wide Banner + Fullscreen)
  state._lastCalc = { effectiveAge, hEval, wEval, bmiEval, hcEval, targetH, projectedH, boneAgePred };
  renderDrawerSummary();
  renderCharts();

  // 5. Auto-sync Dev Band & Secondary Tabs if active
  if (effectiveAge !== null) {
    const months = effectiveAge * 12;
    const matched = DEV_MILESTONES.find((b) => months <= b.maxMonths) || DEV_MILESTONES[DEV_MILESTONES.length - 1];
    if (matched && state.devBandId !== matched.id && !state._userPickedDevBand) {
      state.devBandId = matched.id;
      if ($('devAgeSelect')) $('devAgeSelect').value = matched.id;
    }
  }

  if (state.activeTab === 'sga-newborn') renderSGA();
  if (state.activeTab === 'dev-screen') renderDevScreening();
  if (state.activeTab === 'ref-tables') renderReferenceTable();
  if (state.activeTab === 'quick-ref') renderQuickReference();
}

function renderDrawerSummary() {
  const sexLabel = state.sex === 'boy' ? '男孩' : '女孩';
  $('drawerSumSex').textContent = sexLabel;
  if (state.birthdayParsed && state.ageInfo && !state.ageInfo.error) {
    $('drawerSumDob').textContent = state.birthdayParsed.displayAD;
    $('drawerSumAge').textContent = state.ageInfo.corrected
      ? `${state.ageInfo.label}（矯正 ${state.ageInfo.corrected.label}）`
      : state.ageInfo.label;
  } else {
    $('drawerSumDob').textContent = '--';
    $('drawerSumAge').textContent = '尚未輸入生日';
  }
  $('drawerSumHeight').textContent = Number.isFinite(state.heightCm)
    ? `${state.heightCm.toFixed(1)} cm`
    : '--';
  $('drawerSumWeight').textContent = Number.isFinite(state.weightKg)
    ? `${state.weightKg.toFixed(1)} kg`
    : '--';
}

function renderCharts() {
  const c = state._lastCalc || {};
  const isLandscapeOrWide = window.innerWidth >= 700;
  const baseParams = {
    sex: state.sex,
    metric: state.chartMetric,
    ageYears: c.effectiveAge ?? null,
    value: state.chartMetric === 'h' ? state.heightCm : state.weightKg,
    projectedAdult: c.projectedH?.projected ?? null,
    targetHeight: c.targetH ?? null
  };

  // Wide bottom banner chart
  $('growthChartContainer').innerHTML = renderGrowthChartSVG({
    ...baseParams,
    width: isLandscapeOrWide ? 940 : 680,
    height: isLandscapeOrWide ? 360 : 370
  });

  // Fullscreen modal chart (auto-adapts to portrait/landscape screen size)
  if (state.isChartFullscreen) {
    const fsBox = $('fullscreenChartContainer');
    const rect = fsBox.getBoundingClientRect();
    const boxW = Math.max(360, rect.width || window.innerWidth);
    const boxH = Math.max(240, rect.height || window.innerHeight - 110);
    const aspect = boxW / boxH;
    // Pick clean logical viewBox scaled to actual viewport aspect ratio
    const svgW = aspect >= 1 ? Math.round(Math.min(1100, Math.max(760, boxW))) : Math.round(Math.max(540, boxW * 1.25));
    const svgH = Math.round(svgW / Math.max(0.75, Math.min(2.6, aspect)));

    fsBox.innerHTML = renderGrowthChartSVG({
      ...baseParams,
      width: svgW,
      height: svgH
    });

    const sexLabel = state.sex === 'boy' ? '男孩' : '女孩';
    const metricLabel = state.chartMetric === 'h' ? '身高曲線' : '體重曲線';
    $('fsChartTitle').textContent = `台灣${sexLabel}${metricLabel}`;

    const metaParts = [];
    if (state.ageInfo && !state.ageInfo.error) metaParts.push(state.ageInfo.label);
    if (state.chartMetric === 'h' && state.heightCm) {
      const prTxt = c.hEval ? `（PR ${c.hEval.percentile.toFixed(1)}）` : '';
      metaParts.push(`${state.heightCm} cm${prTxt}`);
    } else if (state.chartMetric === 'w' && state.weightKg) {
      const prTxt = c.wEval ? `（PR ${c.wEval.percentile.toFixed(1)}）` : '';
      metaParts.push(`${state.weightKg} kg${prTxt}`);
    }
    $('fsChartMeta').textContent = metaParts.join(' ｜ ');
  }
}

function openChartFullscreen() {
  state.isChartFullscreen = true;
  const modal = $('chartFullscreenModal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('fs-open');

  // Attempt native Fullscreen API where supported (Android/Desktop); CSS modal handles iOS Safari seamlessly
  if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
  requestAnimationFrame(() => renderCharts());
}

function closeChartFullscreen() {
  if (!state.isChartFullscreen) return;
  state.isChartFullscreen = false;
  const modal = $('chartFullscreenModal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('fs-open');

  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
  requestAnimationFrame(() => renderCharts());
}

function renderMetricCard({ evalObj, valId, metaId, badgeId, dotId, unit, emptyText }) {
  const badgeEl = $(badgeId);
  const dotEl = $(dotId);
  if (!evalObj) {
    $(valId).textContent = '--';
    $(metaId).textContent = emptyText;
    badgeEl.style.display = 'none';
    dotEl.style.display = 'none';
    return;
  }
  const prText =
    evalObj.percentile < 3
      ? '< PR 3'
      : evalObj.percentile > 97
      ? '> PR 97'
      : `PR ${evalObj.percentile.toFixed(1)}`;
  $(valId).textContent = prText;
  $(metaId).textContent = `同齡均標 P50：${evalObj.p50.toFixed(1)} ${unit}（P3–P97：${evalObj.p3.toFixed(
    1
  )}–${evalObj.p97.toFixed(1)}）`;
  badgeEl.style.display = 'inline-flex';
  badgeEl.className = `badge ${evalObj.status}`;
  badgeEl.textContent = evalObj.badge;

  dotEl.style.display = 'block';
  dotEl.style.left = `${Math.max(2, Math.min(98, evalObj.percentile))}%`;
}

/* ==========================================================================
   Tab 2: SGA Newborn
   ========================================================================== */
function renderSGA() {
  const resArea = $('sgaResultArea');
  const badge = $('sgaStatusBadge');
  const res = evaluateBirthWeight(state.sex, state.sgaPlurality, state.sgaGA, state.sgaWeightG);
  if (!res) {
    badge.style.display = 'none';
    resArea.className = 'empty-state';
    resArea.textContent = '請輸入懷孕週數（24–42 週）與出生體重（公克）以立即判讀 SGA / AGA / LGA。';
    return;
  }
  if (res.error) {
    badge.style.display = 'none';
    resArea.className = 'empty-state';
    resArea.textContent = res.error;
    return;
  }
  badge.style.display = 'inline-flex';
  badge.className = `badge ${res.status}`;
  badge.textContent = res.code;
  resArea.className = '';
  resArea.innerHTML = `
    <div style="font-size:1.15rem;font-weight:800;margin-bottom:0.5rem;color:var(--text-primary);">${res.title}</div>
    <div class="metrics-grid" style="margin-bottom:0.75rem;">
      <div class="metric-card">
        <div class="metric-head"><span>第 10 百分位 (SGA 切點)</span></div>
        <div class="metric-main num">${res.p10} g</div>
      </div>
      <div class="metric-card">
        <div class="metric-head"><span>第 50 百分位 (中位數)</span></div>
        <div class="metric-main num">${res.p50} g</div>
      </div>
      <div class="metric-card">
        <div class="metric-head"><span>第 90 百分位 (LGA 切點)</span></div>
        <div class="metric-main num">${res.p90} g</div>
      </div>
    </div>
    <div class="clinic-note" style="margin-top:0;">${res.note}</div>
  `;
}

/* ==========================================================================
   Tab 3: Development Screening (0-6y)
   ========================================================================== */
function initDevSelect() {
  const sel = $('devAgeSelect');
  sel.innerHTML = DEV_MILESTONES.map(
    (b) => `<option value="${b.id}">${b.label}</option>`
  ).join('');
  sel.value = state.devBandId;
  sel.addEventListener('change', () => {
    state.devBandId = sel.value;
    state._userPickedDevBand = true;
    renderDevScreening();
  });
}

function renderDevScreening() {
  const band = DEV_MILESTONES.find((b) => b.id === state.devBandId) || DEV_MILESTONES[0];
  let passCount = 0;
  let failCount = 0;
  let skipCount = 0;

  const listHtml = band.items
    .map((item, idx) => {
      const key = `${band.id}-${idx}`;
      const ans = state.devAnswers[key] || '';
      if (ans === 'pass') passCount++;
      if (ans === 'fail') failCount++;
      if (ans === 'skip') skipCount++;

      return `
        <div class="dev-item">
          <div>
            <span class="dev-domain">${item.domain}</span>
            <span>${item.text}</span>
          </div>
          <div class="dev-actions" data-dev-key="${key}">
            <button type="button" class="dev-choice pass ${ans === 'pass' ? 'active' : ''}" data-val="pass">會</button>
            <button type="button" class="dev-choice fail ${ans === 'fail' ? 'active' : ''}" data-val="fail">不會</button>
            <button type="button" class="dev-choice skip ${ans === 'skip' ? 'active' : ''}" data-val="skip">暫不評估</button>
          </div>
        </div>
      `;
    })
    .join('');

  $('devChecklist').innerHTML = listHtml;

  const total = band.items.length;
  const answered = passCount + failCount + skipCount;
  const banner = $('devSummaryBanner');
  if (answered === 0) {
    banner.textContent = `目前區間「${band.label}」共 ${total} 項核心里程碑，請點選「會／不會／暫不評估」。`;
  } else if (failCount > 0) {
    banner.textContent = `目前勾選 ${failCount} 項「不會」（已通過 ${passCount}/${total} 項）。若有任一領域未達標，建議安排小兒神經科或兒童發展聯合評估中心進一步評估。`;
  } else {
    banner.textContent = `已完成 ${answered}/${total} 項評估（通過 ${passCount} 項），目前皆符合此月齡區間發展進度。`;
  }
}

/* ==========================================================================
   Tab 4: Taiwan Height/Weight & BMI Reference Tables
   ========================================================================== */
function updateRefTableButtons() {
  document.querySelectorAll('#refTableSwitch .pill-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.reftable === state.refTableKey);
  });
}

function renderReferenceTable() {
  const container = $('refTableContainer');
  const effAge = getEffectiveAgeYears();

  if (state.refTableKey === 'bmi') {
    const boyList = BMI_TABLE.boy;
    const girlList = BMI_TABLE.girl;
    const rows = boyList
      .map((b, i) => {
        const g = girlList[i];
        const isHighlight = effAge !== null && Math.abs(effAge - b.age) <= 0.26;
        return `
          <tr class="${isHighlight ? 'highlight-row' : ''}">
            <td>${b.age === 0 ? '出生' : `${b.age} 歲`}</td>
            <td>&lt; ${b.under.toFixed(1)}</td>
            <td>${b.under.toFixed(1)}–${b.over.toFixed(1)}</td>
            <td>≥ ${b.over.toFixed(1)}</td>
            <td>≥ ${b.obese.toFixed(1)}</td>
            <td>&lt; ${g.under.toFixed(1)}</td>
            <td>${g.under.toFixed(1)}–${g.over.toFixed(1)}</td>
            <td>≥ ${g.over.toFixed(1)}</td>
            <td>≥ ${g.obese.toFixed(1)}</td>
          </tr>
        `;
      })
      .join('');

    container.innerHTML = `
      <table class="ref-table">
        <thead>
          <tr>
            <th rowspan="2">年齡</th>
            <th colspan="4">男性 BMI (kg/m²)</th>
            <th colspan="4">女性 BMI (kg/m²)</th>
          </tr>
          <tr>
            <th>過輕</th><th>正常</th><th>過重</th><th>肥胖</th>
            <th>過輕</th><th>正常</th><th>過重</th><th>肥胖</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    return;
  }

  const [sex, metric] = state.refTableKey.split('-');
  const list = GROWTH_TABLE[sex];
  const rows = list
    .map((row, idx) => {
      const nextAge = list[idx + 1]?.age ?? 99;
      const prevAge = list[idx - 1]?.age ?? -1;
      const isHighlight =
        effAge !== null &&
        Math.abs(effAge - row.age) <= Math.min(Math.abs(nextAge - row.age), Math.abs(row.age - prevAge)) / 2 + 0.01;
      const grade = GRADE_MAP[row.age] || '—';
      const vals = row[metric];
      return `
        <tr class="${isHighlight ? 'highlight-row' : ''}">
          <td>${grade}</td>
          <td>${row.age === 0 ? '出生' : `${row.age} 歲`}</td>
          <td>${vals[0].toFixed(1)}</td>
          <td>${vals[1].toFixed(1)}</td>
          <td>${vals[2].toFixed(1)}</td>
          <td><strong>${vals[3].toFixed(1)}</strong></td>
          <td>${vals[4].toFixed(1)}</td>
          <td>${vals[5].toFixed(1)}</td>
          <td>${vals[6].toFixed(1)}</td>
        </tr>
      `;
    })
    .join('');

  container.innerHTML = `
    <table class="ref-table">
      <thead>
        <tr>
          <th>年級</th>
          <th>年齡</th>
          <th>PR 3</th>
          <th>PR 15</th>
          <th>PR 25</th>
          <th>PR 50 (均標)</th>
          <th>PR 75</th>
          <th>PR 85</th>
          <th>PR 97</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

/* ==========================================================================
   Tab 5: Pediatric Quick Clinical Reference
   ========================================================================== */
function renderQuickReference() {
  const effAge = getEffectiveAgeYears();
  const ref =
    effAge !== null
      ? QUICK_REF_BY_AGE.find((r) => effAge <= r.maxAge) || QUICK_REF_BY_AGE[QUICK_REF_BY_AGE.length - 1]
      : QUICK_REF_BY_AGE[4]; // Default 6–12y school age if no birthday entered

  $('quickRefAgeTitle').textContent =
    effAge !== null
      ? `目前兒童適用段：${ref.label}（${state.ageInfo.label}）`
      : `預設顯示：${ref.label}（輸入生日後將自動切換）`;

  let weightEst = '輸入體重可同步估算';
  if (state.weightKg && effAge !== null) {
    const kcalPerKg = effAge < 0.35 ? 105 : effAge < 1 ? 92 : effAge < 3 ? 85 : effAge < 6 ? 70 : effAge < 12 ? 55 : 42;
    weightEst = `約 ${Math.round(state.weightKg * kcalPerKg)} kcal／天（依 ${state.weightKg} kg 粗估）`;
  }
  $('quickRefWeightTag').textContent = weightEst;

  $('quickRefGrid').innerHTML = `
    <div class="card">
      <div class="card-title">🌙 建議睡眠時間</div>
      <p class="ref-kv">${ref.sleep}</p>
      <p class="pred-sub">生長激素主要於夜間深層睡眠分泌，建議固定作息、避免睡前使用 3C 產品。</p>
    </div>
    <div class="card">
      <div class="card-title">🍽️ 每日熱量需求參考</div>
      <p class="ref-kv">${ref.calories}</p>
      <p class="pred-sub">${weightEst}。實際需求依活動量與生長曲線調整。</p>
    </div>
    <div class="card">
      <div class="card-title">🦷 發牙與口腔進度</div>
      <p class="ref-kv">${ref.teeth}</p>
      <p class="pred-sub">長出第一顆牙起即可每半年接受健保補助塗氟與口腔檢查。</p>
    </div>
    <div class="card">
      <div class="card-title">❤️ 正常生命徵候參考</div>
      <p class="ref-kv num">心率：${ref.vitals.hr}</p>
      <p class="ref-kv num">呼吸：${ref.vitals.rr}</p>
      <p class="ref-kv num">血壓：${ref.vitals.bp}</p>
    </div>
  `;
}

/* ==========================================================================
   Copy Clinic Summary
   ========================================================================== */
async function copySummary() {
  const c = state._lastCalc || {};
  const lines = [
    `【兒童生長曲線與預測身高摘要】`,
    `性別：${state.sex === 'boy' ? '男' : '女'}`
  ];
  if (state.birthdayParsed && state.ageInfo && !state.ageInfo.error) {
    lines.push(
      `生日：${state.birthdayParsed.displayAD}（${state.birthdayParsed.displayROC}）｜年齡：${state.ageInfo.label}`
    );
    if (state.ageInfo.corrected) {
      lines.push(`早產矯正年齡：${state.ageInfo.corrected.label}（出生 ${state.pretermGA} 週）`);
    }
  }
  if (c.hEval) {
    lines.push(`身高：${state.heightCm} cm（PR ${c.hEval.percentile.toFixed(1)}，${c.hEval.badge}）`);
  }
  if (c.wEval) {
    lines.push(`體重：${state.weightKg} kg（PR ${c.wEval.percentile.toFixed(1)}，${c.wEval.badge}）`);
  }
  if (c.bmiEval) {
    lines.push(`BMI：${c.bmiEval.bmi.toFixed(1)}（${c.bmiEval.category}，同齡正常 ${c.bmiEval.normalRangeText}）`);
  }
  if (c.targetH) {
    lines.push(
      `遺傳目標身高：${c.targetH.mid.toFixed(1)} cm（±5 cm：${c.targetH.low5.toFixed(1)}–${c.targetH.high5.toFixed(1)} cm；父 ${state.fatherCm} / 母 ${state.motherCm}）`
    );
  }
  if (c.projectedH) {
    lines.push(`目前曲線推估 18 歲身高：${c.projectedH.projected.toFixed(1)} cm`);
  }
  if (c.boneAgePred?.primaryProjected) {
    lines.push(
      `骨齡預測成年身高：${c.boneAgePred.primaryProjected.toFixed(1)} cm（${c.boneAgePred.baStatusText || '骨齡評估'}）`
    );
  }

  const text = lines.join('\n');
  try {
    await navigator.clipboard.writeText(text);
    showToast('已複製門診評估摘要');
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('已複製門診評估摘要');
  }
}

/* ==========================================================================
   Reset All Inputs
   ========================================================================== */
function resetAll() {
  [
    'birthdayText', 'birthdayCalendar', 'childHeight', 'childWeight',
    'fatherHeight', 'motherHeight', 'boneAgeYears', 'boneAgeMonths',
    'boneAgeHeight', 'childHC', 'pretermGA', 'sgaGA', 'sgaWeight'
  ].forEach((id) => {
    const el = $(id);
    if (el) el.value = '';
  });

  state.birthdayParsed = null;
  state.ageInfo = null;
  state.heightCm = null;
  state.weightKg = null;
  state.fatherCm = null;
  state.motherCm = null;
  state.boneAgeY = null;
  state.boneAgeM = null;
  state.boneAgeH = null;
  state.hcCm = null;
  state.pretermGA = null;
  state.sgaGA = null;
  state.sgaWeightG = null;
  state._userPickedDevBand = false;

  recalculateAll();
  showToast('已清空所有欄位');
}

/* ==========================================================================
   Event Wiring & Bootstrap
   ========================================================================== */
function bindEvents() {
  // Drawer open/close
  $('menuOpenBtn').addEventListener('click', openDrawer);
  $('menuCloseBtn').addEventListener('click', closeDrawer);
  $('drawerBackdrop').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (state.isChartFullscreen) {
        closeChartFullscreen();
      } else {
        closeDrawer();
      }
    }
  });

  // Quick +- UI Scale
  $('scaleDownBtn').addEventListener('click', () => {
    if (state.scaleIndex > 0) {
      state.scaleIndex--;
      applyScale();
    }
  });
  $('scaleUpBtn').addEventListener('click', () => {
    if (state.scaleIndex < SCALE_STEPS.length - 1) {
      state.scaleIndex++;
      applyScale();
    }
  });
  $('scaleResetBtn').addEventListener('click', () => {
    state.scaleIndex = 2;
    applyScale();
  });

  // Drawer tab switching
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Topbar actions
  $('copySummaryBtn').addEventListener('click', copySummary);
  $('resetAllBtn').addEventListener('click', resetAll);

  // Sex switcher
  document.querySelectorAll('.sex-btn').forEach((btn) => {
    btn.addEventListener('click', () => setSex(btn.dataset.sex));
  });

  // Birthday numeric input -> sync calendar
  $('birthdayText').addEventListener('input', (e) => {
    const parsed = parseBirthdayInput(e.target.value);
    state.birthdayParsed = parsed;
    if (parsed) {
      $('birthdayCalendar').value = parsed.iso;
      state.ageInfo = calculateAge(parsed.date, new Date(), state.pretermGA);
    } else {
      state.ageInfo = null;
    }
    recalculateAll();
  });

  // Birthday calendar picker -> sync numeric input
  $('birthdayCalendar').addEventListener('change', (e) => {
    const val = e.target.value; // YYYY-MM-DD
    const parsed = parseBirthdayInput(val);
    state.birthdayParsed = parsed;
    if (parsed) {
      $('birthdayText').value = parsed.displayAD;
      state.ageInfo = calculateAge(parsed.date, new Date(), state.pretermGA);
    } else {
      state.ageInfo = null;
    }
    recalculateAll();
  });

  // Numeric fields
  const bindNum = (id, key, afterFn) => {
    $(id).addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      state[key] = Number.isFinite(v) ? v : null;
      if (afterFn) afterFn();
      recalculateAll();
    });
  };

  bindNum('childHeight', 'heightCm');
  bindNum('childWeight', 'weightKg');
  bindNum('fatherHeight', 'fatherCm');
  bindNum('motherHeight', 'motherCm');
  bindNum('boneAgeYears', 'boneAgeY');
  bindNum('boneAgeMonths', 'boneAgeM');
  bindNum('boneAgeHeight', 'boneAgeH');
  bindNum('childHC', 'hcCm');
  bindNum('pretermGA', 'pretermGA', () => {
    if (state.birthdayParsed) {
      state.ageInfo = calculateAge(state.birthdayParsed.date, new Date(), state.pretermGA);
    }
  });

  // Collapsible advanced section
  $('advancedToggleBtn').addEventListener('click', () => {
    const body = $('advancedPanel');
    const isOpen = body.classList.toggle('open');
    $('advancedToggleBtn').setAttribute('aria-expanded', String(isOpen));
    $('advancedToggleIcon').textContent = isOpen ? '−' : '＋';
  });

  // Chart metric toggle (Height / Weight — synced across banner & fullscreen modal)
  document.querySelectorAll('.chart-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.chartMetric = btn.dataset.chartMetric;
      document.querySelectorAll('.chart-tab').forEach((b) =>
        b.classList.toggle('active', b.dataset.chartMetric === state.chartMetric)
      );
      renderCharts();
    });
  });

  // Fullscreen growth chart open / close & auto orientation reflow
  $('chartFullscreenBtn').addEventListener('click', openChartFullscreen);
  $('chartFullscreenCloseBtn').addEventListener('click', closeChartFullscreen);

  let resizeTimer = null;
  const handleViewportChange = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderCharts(), 80);
  };
  window.addEventListener('resize', handleViewportChange);
  window.addEventListener('orientationchange', () => {
    setTimeout(() => renderCharts(), 180);
  });
  document.addEventListener('fullscreenchange', () => {
    if (state.isChartFullscreen) {
      setTimeout(() => renderCharts(), 100);
    }
  });

  // SGA Tab
  document.querySelectorAll('#pluralitySwitch .pill-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.sgaPlurality = btn.dataset.plurality;
      document.querySelectorAll('#pluralitySwitch .pill-btn').forEach((b) =>
        b.classList.toggle('active', b === btn)
      );
      renderSGA();
    });
  });
  $('sgaGA').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    state.sgaGA = Number.isFinite(v) ? v : null;
    if (state.sgaGA && state.sgaGA < 37) {
      state.pretermGA = state.sgaGA;
      $('pretermGA').value = String(state.sgaGA);
      if (state.birthdayParsed) {
        state.ageInfo = calculateAge(state.birthdayParsed.date, new Date(), state.pretermGA);
      }
    }
    renderSGA();
  });
  $('sgaWeight').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    state.sgaWeightG = Number.isFinite(v) ? v : null;
    renderSGA();
  });

  // Development Screening Tab
  $('devChecklist').addEventListener('click', (e) => {
    const btn = e.target.closest('.dev-choice');
    if (!btn) return;
    const key = btn.parentElement.dataset.devKey;
    state.devAnswers[key] = btn.dataset.val;
    renderDevScreening();
  });
  $('devPrefillNormalBtn').addEventListener('click', () => {
    const band = DEV_MILESTONES.find((b) => b.id === state.devBandId);
    if (!band) return;
    band.items.forEach((_, idx) => {
      state.devAnswers[`${band.id}-${idx}`] = 'pass';
    });
    renderDevScreening();
    showToast('已預填此月齡正常值');
  });
  $('devResetBtn').addEventListener('click', () => {
    const band = DEV_MILESTONES.find((b) => b.id === state.devBandId);
    if (!band) return;
    band.items.forEach((_, idx) => {
      delete state.devAnswers[`${band.id}-${idx}`];
    });
    renderDevScreening();
  });

  // Reference Tables Tab
  document.querySelectorAll('#refTableSwitch .pill-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.refTableKey = btn.dataset.reftable;
      updateRefTableButtons();
      renderReferenceTable();
    });
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
}

// Initialize App
loadSavedScale();
initDevSelect();
bindEvents();
setSex('girl');
registerServiceWorker();
