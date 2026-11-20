import {
  GROWTH_TABLE,
  HEAD_CIRCUMFERENCE_TABLE,
  PERCENTILE_KEYS,
  PERCENTILE_Z,
  HC_PERCENTILE_KEYS,
  HC_PERCENTILE_Z
} from '../data/growthData.js';
import { BMI_TABLE } from '../data/bmiData.js';
import { BAYLEY_PINNEAU_AVG, BIRTH_WEIGHT_GA } from '../data/clinicalData.js';

/**
 * Standard normal CDF Φ(z) using Abramowitz & Stegun approximation
 */
export function normalCDF(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p =
    d *
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

/**
 * Parse flexible birthday input:
 * - AD 8 digits: 20180512
 * - ROC 7 digits: 1070512, or 6 digits: 980512
 * - Separated AD/ROC: 2018/5/12, 2018-05-12, 107/5/12, 107.05.12
 */
export function parseBirthdayInput(raw, modeHint = 'auto') {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/\s+/g, '');
  if (!cleaned) return null;

  let year, month, day;

  if (/^\d{6,8}$/.test(cleaned)) {
    if (cleaned.length === 8) {
      year = parseInt(cleaned.slice(0, 4), 10);
      month = parseInt(cleaned.slice(4, 6), 10);
      day = parseInt(cleaned.slice(6, 8), 10);
    } else if (cleaned.length === 7) {
      year = parseInt(cleaned.slice(0, 3), 10) + 1911;
      month = parseInt(cleaned.slice(3, 5), 10);
      day = parseInt(cleaned.slice(5, 7), 10);
    } else if (cleaned.length === 6) {
      // ROC YYMMDD (e.g. 980512 -> 1911 + 98 = 2009)
      const yy = parseInt(cleaned.slice(0, 2), 10);
      year = modeHint === 'ad' ? 2000 + yy : 1911 + yy;
      month = parseInt(cleaned.slice(2, 4), 10);
      day = parseInt(cleaned.slice(4, 6), 10);
    }
  } else {
    const parts = cleaned.split(/[\/\-.\s]+/).filter(Boolean);
    if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    day = parseInt(parts[2], 10);
    if (year < 1900) {
      year += 1911;
    }
  }

  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  const pad = (n) => String(n).padStart(2, '0');
  const rocYear = year - 1911;
  return {
    date,
    year,
    month,
    day,
    rocYear,
    iso: `${year}-${pad(month)}-${pad(day)}`,
    displayAD: `${year}/${pad(month)}/${pad(day)}`,
    displayROC: `民國 ${rocYear} 年 ${pad(month)} 月 ${pad(day)} 日`,
    compactAD: `${year}${pad(month)}${pad(day)}`,
    compactROC: `${rocYear}${pad(month)}${pad(day)}`
  };
}

/**
 * Calculate exact chronological age & optional preterm corrected age
 */
export function calculateAge(birthDate, examDate = new Date(), gestationalWeeks = null) {
  if (!birthDate || !(birthDate instanceof Date) || isNaN(birthDate.getTime())) return null;
  const start = new Date(birthDate.getFullYear(), birthDate.getMonth(), birthDate.getDate());
  const end = new Date(examDate.getFullYear(), examDate.getMonth(), examDate.getDate());
  const diffMs = end.getTime() - start.getTime();
  if (diffMs < 0) return { error: '生日晚於評估日期' };

  const totalDays = Math.floor(diffMs / 86400000);
  const ageYears = totalDays / 365.2425;

  let years = end.getFullYear() - start.getFullYear();
  let months = end.getMonth() - start.getMonth();
  let days = end.getDate() - start.getDate();

  if (days < 0) {
    const prevMonthLastDay = new Date(end.getFullYear(), end.getMonth(), 0).getDate();
    days += prevMonthLastDay;
    months -= 1;
  }
  if (months < 0) {
    months += 12;
    years -= 1;
  }

  const totalMonths = years * 12 + months + days / 30.4375;

  let corrected = null;
  if (
    gestationalWeeks !== null &&
    gestationalWeeks >= 22 &&
    gestationalWeeks < 37 &&
    ageYears < 2.5
  ) {
    const pretermDays = Math.round((40 - gestationalWeeks) * 7);
    const corrDays = Math.max(0, totalDays - pretermDays);
    const corrYears = corrDays / 365.2425;
    const corrMonths = Math.floor(corrDays / 30.4375);
    const corrRemDays = Math.round(corrDays - corrMonths * 30.4375);
    corrected = {
      totalDays: corrDays,
      ageYears: corrYears,
      totalMonths: corrDays / 30.4375,
      label:
        corrMonths >= 12
          ? `${Math.floor(corrMonths / 12)} 歲 ${corrMonths % 12} 個月`
          : `${corrMonths} 個月 ${Math.max(0, corrRemDays)} 天`
    };
  }

  const label =
    years >= 2
      ? `${years} 歲 ${months} 個月`
      : years === 1
      ? `1 歲 ${months} 個月（${Math.floor(totalMonths)} 個月）`
      : `${months} 個月 ${days} 天`;

  return {
    years,
    months,
    days,
    totalDays,
    totalMonths,
    ageYears,
    label,
    corrected
  };
}

/**
 * Linearly interpolate percentile array at given age
 */
export function interpolateCurveAtAge(table, ageYears, key) {
  const clampedAge = Math.max(table[0].age, Math.min(table[table.length - 1].age, ageYears));
  let lower = table[0];
  let upper = table[table.length - 1];

  for (let i = 0; i < table.length - 1; i++) {
    if (clampedAge >= table[i].age && clampedAge <= table[i + 1].age) {
      lower = table[i];
      upper = table[i + 1];
      break;
    }
  }

  const span = upper.age - lower.age;
  const ratio = span === 0 ? 0 : (clampedAge - lower.age) / span;
  return lower[key].map((v, idx) => v + (upper[key][idx] - v) * ratio);
}

/**
 * Convert a measurement value to Z-score & Percentile using piecewise Z-space interpolation
 */
export function valueToZAndPercentile(value, curveValues, zGrid = PERCENTILE_Z) {
  const n = curveValues.length;
  let z;

  if (value <= curveValues[0]) {
    const slope = (zGrid[1] - zGrid[0]) / Math.max(0.01, curveValues[1] - curveValues[0]);
    z = zGrid[0] + (value - curveValues[0]) * slope;
  } else if (value >= curveValues[n - 1]) {
    const slope =
      (zGrid[n - 1] - zGrid[n - 2]) / Math.max(0.01, curveValues[n - 1] - curveValues[n - 2]);
    z = zGrid[n - 1] + (value - curveValues[n - 1]) * slope;
  } else {
    for (let i = 0; i < n - 1; i++) {
      if (value >= curveValues[i] && value <= curveValues[i + 1]) {
        const span = curveValues[i + 1] - curveValues[i];
        const ratio = span === 0 ? 0 : (value - curveValues[i]) / span;
        z = zGrid[i] + (zGrid[i + 1] - zGrid[i]) * ratio;
        break;
      }
    }
  }

  z = Math.max(-4.5, Math.min(4.5, z));
  const percentile = Math.max(0.1, Math.min(99.9, normalCDF(z) * 100));
  return { zScore: z, percentile };
}

/**
 * Convert a Z-score back to a value on a given curve
 */
export function zToCurveValue(z, curveValues, zGrid = PERCENTILE_Z) {
  const n = zGrid.length;
  if (z <= zGrid[0]) {
    const slope = (curveValues[1] - curveValues[0]) / (zGrid[1] - zGrid[0]);
    return curveValues[0] + (z - zGrid[0]) * slope;
  }
  if (z >= zGrid[n - 1]) {
    const slope = (curveValues[n - 1] - curveValues[n - 2]) / (zGrid[n - 1] - zGrid[n - 2]);
    return curveValues[n - 1] + (z - zGrid[n - 1]) * slope;
  }
  for (let i = 0; i < n - 1; i++) {
    if (z >= zGrid[i] && z <= zGrid[i + 1]) {
      const ratio = (z - zGrid[i]) / (zGrid[i + 1] - zGrid[i]);
      return curveValues[i] + (curveValues[i + 1] - curveValues[i]) * ratio;
    }
  }
  return curveValues[Math.floor(n / 2)];
}

/**
 * Format percentile into clinical text & Taipei VGH 8-band interval
 * (<3, 3-15, 15-25, 25-50, 50-75, 75-85, 85-97, >97)
 */
export function classifyPercentile(pr) {
  if (pr < 3) return { badge: '< PR 3（偏低）', band: '< 3', short: '< 3', status: 'warn' };
  if (pr < 15) return { badge: 'PR 3–15（中下）', band: '3–15', short: `${pr.toFixed(0)}`, status: 'caution' };
  if (pr < 25) return { badge: 'PR 15–25（正常偏低）', band: '15–25', short: `${pr.toFixed(0)}`, status: 'normal' };
  if (pr < 50) return { badge: 'PR 25–50（正常中位下）', band: '25–50', short: `${pr.toFixed(0)}`, status: 'normal' };
  if (pr <= 75) return { badge: 'PR 50–75（正常中位上）', band: '50–75', short: `${pr.toFixed(0)}`, status: 'normal' };
  if (pr <= 85) return { badge: 'PR 75–85（正常偏高）', band: '75–85', short: `${pr.toFixed(0)}`, status: 'normal' };
  if (pr <= 97) return { badge: 'PR 85–97（中高）', band: '85–97', short: `${pr.toFixed(0)}`, status: 'caution' };
  return { badge: '> PR 97（偏高）', band: '> 97', short: '> 97', status: 'warn' };
}

/**
 * Evaluate Height, Weight, or Head Circumference
 */
export function evaluateGrowthMetric(sex, ageYears, value, metric = 'h') {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(ageYears)) return null;

  if (metric === 'hc') {
    if (ageYears > 5.05) return { outOfRange: true, message: '國健署／WHO 頭圍標準適用 0–5 歲' };
    const table = HEAD_CIRCUMFERENCE_TABLE[sex];
    const curve = interpolateCurveAtAge(table, ageYears, 'hc');
    const { zScore, percentile } = valueToZAndPercentile(value, curve, HC_PERCENTILE_Z);
    return {
      value,
      zScore,
      percentile,
      ...classifyPercentile(percentile),
      p3: curve[0],
      p50: curve[2],
      p97: curve[4],
      curve
    };
  }

  const table = GROWTH_TABLE[sex];
  const curve = interpolateCurveAtAge(table, ageYears, metric);
  const { zScore, percentile } = valueToZAndPercentile(value, curve, PERCENTILE_Z);
  return {
    value,
    zScore,
    percentile,
    ...classifyPercentile(percentile),
    p3: curve[0],
    p15: curve[1],
    p25: curve[2],
    p50: curve[3],
    p75: curve[4],
    p85: curve[5],
    p97: curve[6],
    curve
  };
}

/**
 * Evaluate BMI against Taiwan MOHW 0.0–18.0y cutoffs
 */
export function evaluateBMI(sex, ageYears, heightCm, weightKg) {
  if (!Number.isFinite(heightCm) || !Number.isFinite(weightKg) || heightCm <= 0 || weightKg <= 0) {
    return null;
  }
  const bmi = weightKg / Math.pow(heightCm / 100, 2);
  const table = BMI_TABLE[sex];
  const clampedAge = Math.max(0, Math.min(18, ageYears));

  let lower = table[0];
  let upper = table[table.length - 1];
  for (let i = 0; i < table.length - 1; i++) {
    if (clampedAge >= table[i].age && clampedAge <= table[i + 1].age) {
      lower = table[i];
      upper = table[i + 1];
      break;
    }
  }
  const span = upper.age - lower.age;
  const ratio = span === 0 ? 0 : (clampedAge - lower.age) / span;
  const under = lower.under + (upper.under - lower.under) * ratio;
  const over = lower.over + (upper.over - lower.over) * ratio;
  const obese = lower.obese + (upper.obese - lower.obese) * ratio;

  let category, status;
  if (bmi < under) {
    category = '過輕';
    status = 'caution';
  } else if (bmi < over) {
    category = '正常範圍';
    status = 'normal';
  } else if (bmi < obese) {
    category = '過重';
    status = 'caution';
  } else {
    category = '肥胖';
    status = 'warn';
  }

  return {
    bmi,
    category,
    status,
    under,
    over,
    obese,
    normalRangeText: `${under.toFixed(1)} – ${over.toFixed(1)}`
  };
}

/**
 * Genetic Target Height (Mid-Parental Height)
 * Matches Taipei VGH / Tanner formula:
 * Boy: (Father + Mother + 13) / 2 ; Girl: (Father + Mother - 13) / 2
 */
export function calculateTargetHeight(sex, fatherCm, motherCm) {
  if (!Number.isFinite(fatherCm) || !Number.isFinite(motherCm) || fatherCm < 100 || motherCm < 100) {
    return null;
  }
  const mid = sex === 'boy' ? (fatherCm + motherCm + 13) / 2 : (fatherCm + motherCm - 13) / 2;
  const adultCurve = GROWTH_TABLE[sex][GROWTH_TABLE[sex].length - 1].h;
  const { percentile } = valueToZAndPercentile(mid, adultCurve, PERCENTILE_Z);

  return {
    mid,
    low5: mid - 5,
    high5: mid + 5,
    low75: mid - 7.5,
    high75: mid + 7.5,
    adultPercentile: percentile
  };
}

/**
 * Project adult height (age 18) along current height Z-score channel
 */
export function projectAdultHeight(sex, heightEval) {
  if (!heightEval || !Number.isFinite(heightEval.zScore)) return null;
  const adultCurve = GROWTH_TABLE[sex][GROWTH_TABLE[sex].length - 1].h;
  const projected = zToCurveValue(heightEval.zScore, adultCurve, PERCENTILE_Z);
  return {
    projected,
    percentile: heightEval.percentile,
    zScore: heightEval.zScore
  };
}

/**
 * Predict adult height using Bone Age
 * 1. Taiwan Growth Curve Bone-Age Channel Projection (aligns with Taipei VGH standalone bone-age logic & Chen-Chang 2010 adult norms)
 * 2. Bayley-Pinneau % of Mature Height (Average table for BA >= 6y, shown as international cross-check)
 */
export function predictHeightByBoneAge(sex, boneAgeYears, examHeightCm, chronoAgeYears = null) {
  if (
    !Number.isFinite(boneAgeYears) ||
    !Number.isFinite(examHeightCm) ||
    boneAgeYears < 1 ||
    boneAgeYears > 18 ||
    examHeightCm < 50
  ) {
    return null;
  }

  // 1. Taiwan Chen & Chang (2010) curve projection using bone age as skeletal age (matches Taipei VGH workflow)
  const baEval = evaluateGrowthMetric(sex, boneAgeYears, examHeightCm, 'h');
  const curveProjected = projectAdultHeight(sex, baEval)?.projected ?? null;

  // 2. Bayley-Pinneau Average % of mature height (applicable >= 6.0y)
  let bpProjected = null;
  let maturePct = null;
  if (boneAgeYears >= 6.0) {
    const bpTable = BAYLEY_PINNEAU_AVG[sex];
    const clampedBA = Math.min(bpTable[bpTable.length - 1].ba, boneAgeYears);
    let lo = bpTable[0];
    let hi = bpTable[bpTable.length - 1];
    for (let i = 0; i < bpTable.length - 1; i++) {
      if (clampedBA >= bpTable[i].ba && clampedBA <= bpTable[i + 1].ba) {
        lo = bpTable[i];
        hi = bpTable[i + 1];
        break;
      }
    }
    const span = hi.ba - lo.ba;
    const ratio = span === 0 ? 0 : (clampedBA - lo.ba) / span;
    maturePct = lo.pct + (hi.pct - lo.pct) * ratio;
    bpProjected = examHeightCm / (maturePct / 100);
  }

  let baDiff = null;
  let baStatusText = '';
  if (Number.isFinite(chronoAgeYears)) {
    baDiff = boneAgeYears - chronoAgeYears;
    if (baDiff >= 2.0) {
      baStatusText = `骨齡超前 ${baDiff.toFixed(1)} 歲（差異 ≥ 2 歲，建議轉介兒童內分泌科確認）`;
    } else if (baDiff >= 1.5) {
      baStatusText = `骨齡超前 ${baDiff.toFixed(1)} 歲（接近 1.5–2 歲警戒，建議每半年追蹤骨齡差距）`;
    } else if (baDiff >= 1.0) {
      baStatusText = `骨齡略超前 ${baDiff.toFixed(1)} 歲`;
    } else if (baDiff <= -2.0) {
      baStatusText = `骨齡落後 ${Math.abs(baDiff).toFixed(1)} 歲（差異 ≥ 2 歲，建議內分泌評估）`;
    } else if (baDiff <= -1.0) {
      baStatusText = `骨齡落後 ${Math.abs(baDiff).toFixed(1)} 歲`;
    } else {
      baStatusText = `骨齡與實際年齡相符（差 ${baDiff >= 0 ? '+' : ''}${baDiff.toFixed(1)} 歲）`;
    }
  }

  return {
    curveProjected,
    bpProjected,
    primaryProjected: curveProjected ?? bpProjected,
    maturePct,
    baPercentile: baEval?.percentile ?? null,
    baBand: baEval?.band ?? null,
    baDiff,
    baStatusText
  };
}

/**
 * Evaluate Newborn Birth Weight by Gestational Age (SGA / AGA / LGA)
 */
export function evaluateBirthWeight(sex, plurality, gaWeeks, birthWeightG) {
  if (!Number.isFinite(gaWeeks) || !Number.isFinite(birthWeightG) || birthWeightG <= 0) {
    return null;
  }
  const wk = Math.round(gaWeeks);
  const table = BIRTH_WEIGHT_GA[plurality]?.[sex];
  if (!table || !table[wk]) {
    const maxW = plurality === 'twin' ? 40 : 42;
    return { error: `請輸入有效懷孕週數（24–${maxW} 週）` };
  }
  const [p10, p50, p90] = table[wk];

  let code, title, status, note;
  if (birthWeightG < p10) {
    code = 'SGA';
    title = 'SGA 小於胎齡兒（< 第 10 百分位）';
    status = 'warn';
    note = '建議追蹤追趕性成長（Catch-up growth），若 2–4 歲身高仍未追上，建議諮詢兒童內分泌科。';
  } else if (birthWeightG > p90) {
    code = 'LGA';
    title = 'LGA 大於胎齡兒（> 第 90 百分位）';
    status = 'caution';
    note = '出生體重高於同胎齡第 90 百分位，後續建議定期追蹤生長曲線與 BMI 變化。';
  } else {
    code = 'AGA';
    title = 'AGA 適於胎齡兒（第 10–90 百分位）';
    status = 'normal';
    note = '出生體重落於台灣同胎齡新生兒正常範圍內。';
  }

  return { code, title, status, note, p10, p50, p90, week: wk };
}

export { PERCENTILE_KEYS };
