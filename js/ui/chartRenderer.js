import { GROWTH_TABLE } from '../data/growthData.js';

/**
 * Render clean, clinic-friendly responsive SVG Growth Curve Chart
 * Displays PR 3, 15, 50, 85, 97 curves + child's current point + optional projected adult height point
 */
export function renderGrowthChartSVG({
  sex = 'boy',
  metric = 'h', // 'h' or 'w'
  ageYears = null,
  value = null,
  projectedAdult = null,
  targetHeight = null
}) {
  const data = GROWTH_TABLE[sex];
  const isBoy = sex === 'boy';
  const accentColor = isBoy ? '#5D7A8C' : '#BF6766';
  const accentSoft = isBoy ? 'rgba(93, 122, 140, 0.14)' : 'rgba(191, 103, 102, 0.14)';

  // Choose smart age window: if child <= 5y and not showing adult projection, offer 0-7y or full 0-18y
  // Default full 0-18y so parents immediately see the full journey to adult height!
  const maxAge = 18;
  const minVal = metric === 'h' ? 40 : 0;
  const maxVal = metric === 'h' ? (isBoy ? 190 : 178) : isBoy ? 86 : 74;

  const W = 680;
  const H = 370;
  const pad = { top: 22, right: 44, bottom: 38, left: 46 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const xOf = (a) => pad.left + (Math.max(0, Math.min(maxAge, a)) / maxAge) * plotW;
  const yOf = (v) =>
    pad.top + plotH - ((Math.max(minVal, Math.min(maxVal, v)) - minVal) / (maxVal - minVal)) * plotH;

  // Curve indices in [3, 15, 25, 50, 75, 85, 97] -> draw 3(0), 15(1), 50(3), 85(5), 97(6)
  const curveSpecs = [
    { idx: 6, label: '97', stroke: '#C8A59E', width: 1.3, dash: '4 3' },
    { idx: 5, label: '85', stroke: '#B4B0A8', width: 1.2, dash: '' },
    { idx: 3, label: '50', stroke: '#6E8B74', width: 2.1, dash: '' },
    { idx: 1, label: '15', stroke: '#B4B0A8', width: 1.2, dash: '' },
    { idx: 0, label: '3', stroke: '#C8A59E', width: 1.3, dash: '4 3' }
  ];

  // Soft shaded band between 15th and 85th percentile
  const upperPts = data.map((d) => `${xOf(d.age).toFixed(1)},${yOf(d[metric][5]).toFixed(1)}`).join(' ');
  const lowerPts = [...data]
    .reverse()
    .map((d) => `${xOf(d.age).toFixed(1)},${yOf(d[metric][1]).toFixed(1)}`)
    .join(' ');

  // Horizontal grid lines
  const yStep = metric === 'h' ? 20 : 10;
  const yTicks = [];
  for (let v = Math.ceil(minVal / yStep) * yStep; v <= maxVal; v += yStep) {
    yTicks.push(v);
  }

  // Vertical grid lines (every 2 years)
  const xTicks = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18];

  const curvesMarkup = curveSpecs
    .map((spec) => {
      const pts = data
        .map((d) => `${xOf(d.age).toFixed(1)},${yOf(d[metric][spec.idx]).toFixed(1)}`)
        .join(' ');
      const last = data[data.length - 1];
      const lx = xOf(last.age) + 6;
      const ly = yOf(last[metric][spec.idx]) + 3.5;
      return `
        <polyline fill="none" stroke="${spec.stroke}" stroke-width="${spec.width}" ${
        spec.dash ? `stroke-dasharray="${spec.dash}"` : ''
      } points="${pts}" />
        <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="10.5" font-weight="${
        spec.label === '50' ? '700' : '500'
      }" fill="${spec.label === '50' ? '#56725C' : '#8A817C'}">P${spec.label}</text>
      `;
    })
    .join('');

  // Optional genetic target height band on age 18 axis (height chart only)
  let targetMarkup = '';
  if (metric === 'h' && targetHeight) {
    const tx = xOf(18) - 2;
    const yTop = yOf(targetHeight.high5);
    const yBot = yOf(targetHeight.low5);
    const yMid = yOf(targetHeight.mid);
    targetMarkup = `
      <line x1="${tx}" y1="${yTop.toFixed(1)}" x2="${tx}" y2="${yBot.toFixed(
      1
    )}" stroke="#6E8B74" stroke-width="4" stroke-linecap="round" opacity="0.55" />
      <circle cx="${tx}" cy="${yMid.toFixed(1)}" r="4" fill="#6E8B74" stroke="#FFFFFF" stroke-width="1.5" />
    `;
  }

  // Child point & dashed projection line to age 18
  let childMarkup = '';
  if (Number.isFinite(ageYears) && Number.isFinite(value) && value > 0) {
    const cx = xOf(ageYears);
    const cy = yOf(value);

    let projLine = '';
    if (metric === 'h' && Number.isFinite(projectedAdult) && ageYears < 17.5) {
      const px = xOf(18);
      const py = yOf(projectedAdult);
      projLine = `
        <line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${px.toFixed(1)}" y2="${py.toFixed(
        1
      )}" stroke="${accentColor}" stroke-width="1.6" stroke-dasharray="5 4" opacity="0.7" />
        <circle cx="${px.toFixed(1)}" cy="${py.toFixed(
        1
      )}" r="4.5" fill="#FFFFFF" stroke="${accentColor}" stroke-width="2" />
      `;
    }

    const labelX = cx > W - 150 ? cx - 10 : cx + 10;
    const textAnchor = cx > W - 150 ? 'end' : 'start';
    const unit = metric === 'h' ? 'cm' : 'kg';

    childMarkup = `
      ${projLine}
      <line x1="${cx.toFixed(1)}" y1="${pad.top}" x2="${cx.toFixed(1)}" y2="${(
      pad.top + plotH
    ).toFixed(1)}" stroke="${accentColor}" stroke-width="1" stroke-dasharray="2 3" opacity="0.35" />
      <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="10" fill="${accentSoft}" />
      <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(
      1
    )}" r="5.5" fill="${accentColor}" stroke="#FFFFFF" stroke-width="2" />
      <text x="${labelX.toFixed(1)}" y="${(cy - 10).toFixed(
      1
    )}" text-anchor="${textAnchor}" font-size="11.5" font-weight="700" fill="${accentColor}">${value.toFixed(
      1
    )} ${unit}</text>
    `;
  }

  return `
    <svg viewBox="0 0 ${W} ${H}" class="growth-svg" role="img" aria-label="${
    isBoy ? '男孩' : '女孩'
  }${metric === 'h' ? '身高' : '體重'}生長曲線圖">
      <rect x="${pad.left}" y="${pad.top}" width="${plotW}" height="${plotH}" rx="6" fill="#FCFBF9" />
      <polygon points="${upperPts} ${lowerPts}" fill="rgba(110, 139, 116, 0.08)" />
      ${yTicks
        .map(
          (v) => `
        <line x1="${pad.left}" y1="${yOf(v).toFixed(1)}" x2="${(pad.left + plotW).toFixed(
            1
          )}" y2="${yOf(v).toFixed(1)}" stroke="#ECE6DF" stroke-width="1" />
        <text x="${pad.left - 8}" y="${(yOf(v) + 3.5).toFixed(
            1
          )}" text-anchor="end" font-size="10.5" fill="#7D7470">${v}</text>
      `
        )
        .join('')}
      ${xTicks
        .map(
          (a) => `
        <line x1="${xOf(a).toFixed(1)}" y1="${pad.top}" x2="${xOf(a).toFixed(1)}" y2="${(
            pad.top + plotH
          ).toFixed(1)}" stroke="#EFEAE4" stroke-width="1" />
        <text x="${xOf(a).toFixed(1)}" y="${H - 15}" text-anchor="middle" font-size="10.5" fill="#7D7470">${a}歲</text>
      `
        )
        .join('')}
      ${curvesMarkup}
      ${targetMarkup}
      ${childMarkup}
      <text x="${pad.left}" y="14" font-size="11" font-weight="600" fill="#6E6562">${
    metric === 'h' ? '身高 (cm)' : '體重 (kg)'
  }</text>
    </svg>
  `;
}
