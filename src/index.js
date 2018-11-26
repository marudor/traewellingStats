// @flow
import { format, getTime, parse } from 'date-fns';
import { promises as fs, readFileSync } from 'fs';
import { google } from 'googleapis';
import { orderBy } from 'lodash';
import authorize from './auth';
import csvParse from 'csv-parse/lib/sync';
import deLocale from 'date-fns/locale/de';

const locale = { locale: deLocale };

// eslint-disable-next-line no-sync
const spreadsheetId = readFileSync('spreadsheetId', 'utf8').trim();

const gsheets = google.sheets('v4');

type Trip = {
  ['Status-ID']: string,
  Zugart: string,
  Zugnummer: string,
  Abfahrtsort: string,
  Abfahrtskoordinaten: string,
  Abfahrtszeit: string,
  Ankunftsort: string,
  Ankunftskoordinaten: string,
  Ankunftszeit: string,
  Reisezeit: string,
  Kilometer: string,
  Punkte: string,
  Status?: string,
  Zwischenhalte?: string,
};

function sanitize(rawCsv: string) {
  let csv = rawCsv;

  if (csv.includes('""Status-ID"')) {
    csv = csv.substr(2, csv.length);
  }

  if (csv.endsWith('"\n"')) {
    csv = csv.substr(0, csv.length - 1);
  }

  return csv;
}

async function parseCSV(path: string): Promise<Trip[]> {
  const rawCsv: string = await fs.readFile(path, 'utf8');
  const csv = sanitize(rawCsv);

  return csvParse(csv, {
    delimiter: '\t',
    relax_column_count: true,
    columns: true,
  });
}

function transformForGoogle(data: Trip[]) {
  return data.reduce((acc, t) => {
    const title = format(t.Abfahrtszeit, 'MMMM yy', locale);

    if (!acc[title]) {
      acc[title] = [];
    }
    acc[title].push([
      format(t.Abfahrtszeit, 'dd.MM.yyyy', locale),
      t.Abfahrtsort,
      t.Ankunftsort,
      Number.parseFloat(t.Kilometer)
        .toFixed(2)
        .replace('.', ','),
    ]);

    return acc;
  }, {});
}

function getSheetInfo() {
  return new Promise((resolve, reject) => {
    gsheets.spreadsheets.get(
      {
        spreadsheetId,
      },
      (e, r) => {
        if (e) {
          reject(e);
        } else {
          resolve(r.data);
        }
      }
    );
  });
}

function formatSheet(sheet) {
  return new Promise((resolve, reject) =>
    gsheets.spreadsheets.batchUpdate(
      {
        spreadsheetId,
        resource: {
          requests: [
            {
              updateDimensionProperties: {
                fields: 'pixelSize',
                properties: {
                  pixelSize: 250,
                },
                range: {
                  dimension: 'COLUMNS',
                  sheetId: sheet.properties.sheetId,
                  startIndex: 1,
                  endIndex: 3,
                },
              },
            },
          ],
        },
      },
      e => {
        if (e) {
          reject(e);
        } else {
          resolve();
        }
      }
    )
  );
}

function createSheet(title: string) {
  return new Promise((resolve, reject) =>
    gsheets.spreadsheets.batchUpdate(
      {
        spreadsheetId,
        resource: {
          requests: [
            {
              addSheet: {
                properties: {
                  hidden: false,
                  title,
                },
              },
            },
          ],
        },
      },
      async (e, r) => {
        if (e) {
          reject(e);
        } else {
          const sheet = r.data.replies[0].addSheet;

          await formatSheet(sheet);
          resolve(sheet);
        }
      }
    )
  );
}

function clearSheet(sheetId) {
  return new Promise((resolve, reject) =>
    gsheets.spreadsheets.values.batchClear(
      {
        spreadsheetId,
        resource: {
          ranges: [`${sheetId}!A1:F5000`],
        },
      },
      e => {
        if (e) {
          reject(e);
        } else {
          resolve();
        }
      }
    )
  );
}

async function fillSheet(rawSheet, data, title: string) {
  let sheet = rawSheet;

  if (!sheet) {
    sheet = await createSheet(title);
  }

  const sheetId = sheet.properties.title;

  await clearSheet(sheetId);
  await new Promise((resolve, reject) =>
    gsheets.spreadsheets.values.batchUpdate(
      {
        spreadsheetId,
        resource: {
          valueInputOption: 'USER_ENTERED',
          data: [
            {
              range: `${sheetId}!A1:D1`,
              values: [['Datum', 'Start', 'Ende', 'Distanz']],
            },
            {
              range: `${sheetId}!A2:D${data.length + 1}`,
              values: data,
            },
            {
              range: `${sheetId}!F2`,
              values: [[`=sum(D2:D${data.length + 1})`]],
            },
          ],
        },
      },
      e => {
        if (e) {
          reject(e);
        } else {
          resolve();
        }
      }
    )
  );
}

async function sortSheets() {
  const { sheets } = await getSheetInfo();
  const sortedSheets = orderBy(sheets, s => getTime(parse(s.properties.title, 'MMMM yy', 0, locale)), 'desc');

  for (let i = 0; i < sortedSheets.length; i += 1) {
    sortedSheets[i].properties.index = i;
  }
  await new Promise((resolve, reject) =>
    gsheets.spreadsheets.batchUpdate(
      {
        spreadsheetId,
        resource: {
          requests: sortedSheets.map(s => ({
            updateSheetProperties: {
              properties: {
                index: s.properties.index,
                sheetId: s.properties.sheetId,
              },
              fields: 'index',
            },
          })),
        },
      },
      e => {
        if (e) {
          reject(e);
        } else {
          resolve();
        }
      }
    )
  );
}

async function doStuff(path: string) {
  const data = await parseCSV(path);

  const reducedData = transformForGoogle(data);

  await authorize();

  const { sheets } = await getSheetInfo();

  Object.keys(reducedData)
    .sort((a, b) => {
      const dateA = parse(a, 'MMMM yy', 0, locale);
      const dateB = parse(b, 'MMMM yy', 0, locale);

      return dateA > dateB ? 1 : -1;
    })
    .reduce(async (p, title) => {
      await p;
      await fillSheet(sheets.find(sheet => sheet.properties.title === title), reducedData[title], title);
    }, Promise.resolve());

  await sortSheets();
}

const filePath = process.argv[2];

if (!filePath) {
  throw new Error('Missing file Path');
}

doStuff(filePath);
