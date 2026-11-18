import { strToU8, zipSync } from 'fflate';
import { browseFinder, coverageLabels, discoveryNames } from '../shared/discovery.mjs';

const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const relationships = 'http://schemas.openxmlformats.org/package/2006/relationships';
const esc = (value) => String(value ?? '').toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const rel = (id, type, target, external = false) => `<Relationship Id="${id}" Type="${office}/${type}" Target="${esc(target)}"${external ? ' TargetMode="External"' : ''}/>`;
const rels = (items) => `${xml}<Relationships xmlns="${relationships}">${items.join('')}</Relationships>`;
const col = (index) => String.fromCharCode(65 + index);
const style = { title: 1, subtitle: 2, header: 3, plain: 4, alt: 5, link: 6, altLink: 7, label: 8, editable: 9 };
const entry = (value, s = style.plain, href) => ({ value, s, href });
const row = (cells, height = 22) => ({ cells, height });
const section = (value) => row([entry(value, style.header)], 25);

function worksheet(widths, rows, { merged = [], freeze = 0, freezeCols = 0, filter, validation } = {}) {
  const links = [], matrix = rows.map(({ cells, height }, i) => {
    const n = i + 1;
    return `<row r="${n}" ht="${height}" customHeight="1">${cells.map(({ value, s, href }, j) => {
      const ref = `${col(j)}${n}`;
      if (href) links.push({ ref, href });
      // Inline strings are always text, including =, +, - and @ prefixes.
      return typeof value === 'number'
        ? `<c r="${ref}" s="${s}"><v>${value}</v></c>`
        : `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
    }).join('')}</row>`;
  }).join('');
  const end = `${col(widths.length - 1)}${rows.length}`;
  const pane = freeze ? `<pane${freezeCols ? ` xSplit="${freezeCols}"` : ''} ySplit="${freeze}" topLeftCell="${col(freezeCols)}${freeze + 1}" activePane="${freezeCols ? 'bottomRight' : 'bottomLeft'}" state="frozen"/>` : '';
  const cols = widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('');
  const linkTags = links.map(({ ref }, i) => `<hyperlink ref="${ref}" r:id="rId${i + 1}"/>`).join('');
  return {
    sheet: `${xml}<worksheet xmlns="${main}" xmlns:r="${office}"><dimension ref="A1:${end}"/><sheetViews><sheetView showGridLines="0" workbookViewId="0">${pane}</sheetView></sheetViews><cols>${cols}</cols><sheetData>${matrix}</sheetData>${filter ? `<autoFilter ref="${filter}:${end}"/>` : ''}${merged.length ? `<mergeCells count="${merged.length}">${merged.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : ''}${validation ? `<dataValidations count="1"><dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="G5:G${rows.length}"><formula1>"${esc(validation)}"</formula1></dataValidation></dataValidations>` : ''}${links.length ? `<hyperlinks>${linkTags}</hyperlinks>` : ''}</worksheet>`,
    links: links.length ? rels(links.map(({ href }, i) => rel(`rId${i + 1}`, 'hyperlink', href, true))) : null,
  };
}

const font = (size, rgb, decoration = '') => `<font>${decoration}<sz val="${size}"/><color rgb="FF${rgb}"/><name val="Calibri"/></font>`;
const fill = (rgb) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
const xf = (fontId, fillId) => `<xf numFmtId="0" fontId="${fontId}" fillId="${fillId}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1" indent="1"/></xf>`;
const styles = `${xml}<styleSheet xmlns="${main}"><fonts count="6">${font(11, '203245')}${font(22, 'FFFFFF', '<b/>')}${font(11, 'DAECEB')}${font(11, 'FFFFFF', '<b/>')}${font(11, '1558A0', '<u/>')}${font(11, '203245', '<b/>')}</fonts><fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fill('172C40')}${fill('14645E')}${fill('FFFFFF')}${fill('F0F6F8')}${fill('EDF7EF')}</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="10"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>${xf(1, 2)}${xf(2, 2)}${xf(3, 3)}${xf(0, 4)}${xf(0, 5)}${xf(4, 4)}${xf(4, 5)}${xf(5, 5)}${xf(0, 6)}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

export function finderWorkbook({ query, location, mode, searchedAt, records, coverage }) {
  const jobs = mode === 'jobs', resultSheet = jobs ? 'Jobs' : 'Business leads';
  const intro = [
    row([entry('Curiousity / Finder', style.title)], 41),
    row([entry('PUBLIC SEARCH  /  REVIEW WORKBOOK', style.subtitle)], 24),
    row([], 12),
  ];
  const merge = ['A1:E1', 'A2:E2'];
  function info(label, value, height) {
    intro.push(row([entry(label, style.label), entry(value)], height));
    merge.push(`B${intro.length}:E${intro.length}`);
  }
  info('Search', `${jobs ? 'Jobs' : 'Business leads'} · ${query}`, 31);
  info('Requested location', location || 'Not specified');
  info('Searched (UTC)', `${searchedAt.slice(0, 16).replace('T', ' ')} · ${records.length} direct ${records.length === 1 ? 'link' : 'links'}`);
  intro.push(row([], 10), section('01  /  SOURCE COVERAGE'));
  merge.push('A8:E8');
  intro.push(row(['Source', 'Links', 'Outcome', 'Method', 'Broader search (not a result)'].map((v) => entry(v, style.header)), 25));
  for (const { source, method, state, count } of coverage) {
    intro.push(row([entry(discoveryNames[source], style.label), entry(count), entry(coverageLabels[state]), entry(method), entry(`Browse ${discoveryNames[source]}`, style.link, browseFinder(source, query, location))], 30));
  }
  intro.push(row([], 10), section('02  /  HOW TO USE'));
  merge.push(`A${intro.length}:E${intro.length}`);
  info('1. Open listing', `Open the ${resultSheet} sheet. Follow the source link to confirm ${jobs ? 'the employer, location and application deadline' : 'the business, service area and public contact channel'}.`, 30);
  info('2. Review and track', `Use the filter row to compare results. Update the Status dropdown and add your own ${jobs ? 'application notes' : 'contact notes or next step'}.`, 30);
  info('3. Check coverage', 'The public index can miss, duplicate or lag listings. Dates and excerpts are from the index; results are not verified or guaranteed current.', 30);
  if (!jobs && coverage.some(({ source }) => source === 'maps')) info('Google Maps', 'Map results are links only. Open each link to review the business on Google Maps; Maps addresses, ratings and reviews are not copied into this workbook.', 30);
  const guide = worksheet([23, 15, 23, 24, 39], intro, { merged: merge });

  const results = [
    row([entry(resultSheet, style.title)], 38),
    row([entry('Open each source to verify it. Green columns are for your own tracking.', style.subtitle)], 24),
    row([], 10),
    row(['#', jobs ? 'Role / listing' : 'Business / listing', 'Source', 'Indexed date (UTC)', 'Source excerpt', 'Source link', 'Status', 'Your notes / next step'].map((v) => entry(v, style.header)), 32),
  ];
  records.forEach(({ title, source, published, excerpt, url }, i) => {
    const band = i % 2 ? style.alt : style.plain;
    results.push(row([entry(i + 1, band), entry(title, band), entry(discoveryNames[source], band), entry(published || '—', band),
      entry(excerpt || (source === 'maps' ? 'Review this listing in Google Maps.' : '—'), band), entry('Open listing ↗', i % 2 ? style.altLink : style.link, url),
      entry('To verify', style.editable), entry('', style.editable)], excerpt.length > 150 ? 82 : excerpt.length > 70 ? 60 : 48));
  });
  const data = worksheet([6, 37, 20, 16, 42, 19, 17, 32], results, {
    merged: ['A1:H1', 'A2:H2'], freeze: 4, freezeCols: 2, filter: 'A4',
    validation: jobs ? 'To verify,Shortlisted,Applied,Not a fit' : 'To verify,Shortlisted,Contacted,Not a fit',
  });

  const types = `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[['workbook', 'sheet.main'], ['styles', 'styles'], ['worksheets/sheet1', 'worksheet'], ['worksheets/sheet2', 'worksheet']].map(([path, name]) => `<Override PartName="/xl/${path}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.${name}+xml"/>`).join('')}</Types>`;
  const files = {
    '[Content_Types].xml': types,
    '_rels/.rels': rels([rel('rId1', 'officeDocument', 'xl/workbook.xml')]),
    'xl/workbook.xml': `${xml}<workbook xmlns="${main}" xmlns:r="${office}"><bookViews><workbookView/></bookViews><sheets><sheet name="Start here" sheetId="1" r:id="rId1"/><sheet name="${resultSheet}" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': rels([rel('rId1', 'worksheet', 'worksheets/sheet1.xml'), rel('rId2', 'worksheet', 'worksheets/sheet2.xml'), rel('rId3', 'styles', 'styles.xml')]),
    'xl/styles.xml': styles,
    'xl/worksheets/sheet1.xml': guide.sheet,
    'xl/worksheets/sheet2.xml': data.sheet,
    ...(guide.links ? { 'xl/worksheets/_rels/sheet1.xml.rels': guide.links } : {}),
    ...(data.links ? { 'xl/worksheets/_rels/sheet2.xml.rels': data.links } : {}),
  };
  return { name: `curiousity-${jobs ? 'jobs' : 'leads'}-${searchedAt.slice(0, 10)}.xlsx`, base64: Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([path, value]) => [path, strToU8(value)])), { level: 6 })).toString('base64') };
}
