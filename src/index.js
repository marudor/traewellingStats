// @flow
import 'moment/locale/de';
import { google } from 'googleapis';
import authorize from './auth';
import csvParse from 'csv-parse/lib/sync';
import fs from 'fs-extra';
import moment from 'moment';

// eslint-disable-next-line no-sync
const spreadsheetId = fs.readFileSync('spreadsheetId', 'utf8').trim();

const gsheets = google.sheets('v4');

type Trip = {
  ['Status-ID']: number,
  Zugart: string,
  Zugnummer: number,
  Abfahrtsort: string,
  Abfahrtskoordinaten: string,
  Abfahrtszeit: Date,
  Ankunftsort: string,
  Ankunftskoordinaten: string,
  Ankunftszeit: Date,
  Reisezeit: string,
  Kilometer: number,
  Punkte: number,
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
  const rawCsv = await fs.readFile(path, 'utf8');
  const csv = sanitize(rawCsv);

  return csvParse(csv, {
    delimiter: '\t',
    relax_column_count: true,
    columns: true,
    auto_parse: true,
    auto_parse_date: true,
  });
}

function transformForGoogle(data: Trip[]) {
  return data.reduce((acc, t) => {
    const date = moment(t.Abfahrtszeit);

    const title = date.format('MMMM YY');

    if (!acc[title]) {
      acc[title] = [];
    }
    acc[title].push([
      date.format('DD.MM.YYYY'),
      t.Abfahrtsort,
      t.Ankunftsort,
      t.Kilometer.toFixed(2).replace('.', ','),
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

async function doStuff(path: string) {
  const data = await parseCSV(path);

  const reducedData = transformForGoogle(data);

  await authorize();

  const { sheets } = await getSheetInfo();

  Object.keys(reducedData)
    .sort((a, b) => {
      const dateA = moment(a, 'MMMM YY');
      const dateB = moment(b, 'MMMM YY');

      return dateA.unix() > dateB.unix() ? 1 : -1;
    })
    .reduce(async (p, title) => {
      await p;
      await fillSheet(sheets.find(sheet => sheet.properties.title === title), reducedData[title], title);
    }, Promise.resolve());
}

const filePath = process.argv[2];

if (!filePath) {
  throw new Error('Missing file Path');
}

doStuff(filePath);
