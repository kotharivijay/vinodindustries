const fs = require('fs');
const { google } = require('googleapis');

const env = fs.readFileSync('.env.local', 'utf8');
const idx = env.indexOf('GOOGLE_SERVICE_ACCOUNT_KEY="');
const jsonStart = env.indexOf('{', idx);
const jsonEnd = env.indexOf('}"', jsonStart);
const saJson = env.substring(jsonStart, jsonEnd + 1);
const creds = JSON.parse(saJson);

const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const sheets = google.sheets({ version: 'v4', auth });

(async () => {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: '1AGOnIxF5HYZSJuD3Hs4_e5NDfS7gL_zVd-AkQdvF9UA',
    range: "'INWERD GRAY'!A1:Q30",
  });
  
  console.log('Sample rows (SN | Month | Date | LotNo):');
  console.log('-'.repeat(70));
  const rows = res.data.values || [];
  rows.forEach((row, i) => {
    const sn = (row[0] || '').padEnd(5);
    const month = (row[1] || '').padEnd(8);
    const date = (row[2] || '').padEnd(15);
    const lotNo = (row[16] || '').padEnd(12);
    console.log(`Row ${String(i+1).padStart(2)} | ${sn} | ${month} | ${date} | ${lotNo}`);
  });
  
  // Full scan
  const allRows = await sheets.spreadsheets.values.get({
    spreadsheetId: '1AGOnIxF5HYZSJuD3Hs4_e5NDfS7gL_zVd-AkQdvF9UA',
    range: "'INWERD GRAY'!A1:Q2000",
  });
  
  let withDate = 0, noDate = 0, withMonth = 0, noMonth = 0, total = 0;
  const sampleDates = [];
  const sampleNoDate = [];
  
  for (const row of (allRows.data.values || [])) {
    const lotNo = row[16] || '';
    if (!lotNo || lotNo === 'A-Lot No') continue;
    total++;
    const dateVal = (row[2] || '').trim();
    const monthVal = (row[1] || '').trim();
    
    if (dateVal) { withDate++; if (sampleDates.length < 5) sampleDates.push(`${lotNo}: date="${dateVal}" month="${monthVal}"`); }
    else { noDate++; if (sampleNoDate.length < 5) sampleNoDate.push(`${lotNo}: month="${monthVal}"`); }
    
    if (monthVal) withMonth++;
    else noMonth++;
  }
  
  console.log('\n--- Summary ---');
  console.log('Total lots:', total);
  console.log('With date:', withDate, '| Without date:', noDate);
  console.log('With month:', withMonth, '| Without month:', noMonth);
  console.log('\nSample WITH date:', sampleDates);
  console.log('Sample WITHOUT date:', sampleNoDate);
  
  fs.unlinkSync('test-sheet.js');
})().catch(e => console.error('Error:', e.message));
