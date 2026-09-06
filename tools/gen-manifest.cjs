#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');

const outfile = process.argv[2];
if (!outfile) throw new Error('Usage: gen-manifest <outfile>');

const appinfo = require('../assets/appinfo.json');
const ipkfile = `${appinfo.id}_${appinfo.version}_all.ipk`;
// ares-package writes into dist/ (npm run package), but repo.json still refers to the
// artifact by its bare filename, so the two are deliberately different values.
const ipkpath = `dist/${ipkfile}`;
const ipkhash = crypto.createHash('sha256').update(fs.readFileSync(ipkpath)).digest('hex');

fs.writeFileSync(
  outfile,
  JSON.stringify({
    id: appinfo.id,
    version: appinfo.version,
    type: appinfo.type,
    title: appinfo.title,
    // appDescription: appinfo.appDescription,
    iconUri: 'https://raw.githubusercontent.com/webosbrew/youtube-webos/main/assets/largeIcon.png',
    sourceUrl: 'https://github.com/webosbrew/youtube-webos',
    rootRequired: false,
    ipkUrl: ipkfile,
    ipkHash: {
      sha256: ipkhash
    }
  })
);
