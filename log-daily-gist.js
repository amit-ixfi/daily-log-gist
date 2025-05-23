#!/usr/bin/env node
import inquirer from 'inquirer';
import { Octokit } from '@octokit/rest';
import dotenv from 'dotenv';
import yargs from 'yargs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

dotenv.config({ path: path.join(__dirname, ".env") });

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_ID = process.env.GIST_ID;
const LOG_FILENAME = process.env.LOG_FILENAME || 'daily-log.md';
const SPACE_4_CHAR = '    ';

if (!GITHUB_TOKEN || !GIST_ID) {
  console.error('Please set GITHUB_TOKEN and GIST_ID in your .env file.');
  process.exit(1);
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });

const QUESTIONS = [
  {
    name: 'whatIDid',
    message: "1. What I did:",
  },
  {
    name: 'whatsNext',
    message: "2. What's next:",
  },
  {
    name: 'whatBlock',
    message: "3. What Block:",
  },
  {
    name: 'productivityScore',
    message: "4. Productivity Score (1-5):",
    validate: (input) => ['1', '2', '3', '4', '5'].includes(input) ? true : 'Enter a number 1-5',
  },
];

async function multiPointPrompt(question) {
  console.log(question.message);
  const points = [];
  let done = false;
  while (!done) {
    const { point } = await inquirer.prompt([
      {
        type: 'input',
        name: 'point',
        message:  `${points.length + 1}` + (points.length === 0 ? ':' : `(⏎ to finish):`),
        filter: (input) => input.trim(),
      },
    ]);
    if (point === '') {
      if (points.length > 0) done = true;
      else console.log('At least one point required.');
    } else {
      points.push(point);
    }
  }
  return points;
}

// Parse CLI arguments
const argv = yargs(process.argv.slice(2))
  .option('date', {
    alias: 'd',
    type: 'string',
    description: 'Specify the date for the log (YYYY-MM-DD)',
  })
  .help()
  .argv;

async function main() {
  const today = argv.date || new Date().toISOString().slice(0, 10);

  const isUpdated = Boolean(argv.date);
  let answers = {};

  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    if (i < 3) {
      answers[q.name] = await multiPointPrompt(q);
    } else {
      const { score } = await inquirer.prompt([
        {
          type: 'input',
          name: 'score',
          message: q.message,
          validate: q.validate,
        },
      ]);
      answers[q.name] = score;
    }
  }

  // Fetch gist content
  const gist = await octokit.gists.get({ gist_id: GIST_ID });
  let logContent = gist.data.files[LOG_FILENAME]?.content || '';

  // Extract and update index
  const indexPattern = /## Index([\s\S]*?)(?=##|$)/;
  let indexMatch = logContent.match(indexPattern);
  let indexDates = [];
  if (indexMatch) {
    indexDates = Array.from(indexMatch[1].matchAll(/\[(\d{4}-\d{2}-\d{2})\]/g)).map(m => m[1]);
  }
  if (!indexDates.includes(today)) indexDates.push(today);
  indexDates.sort((a, b) => b.localeCompare(a)); // Descending
  const newIndex = '## Index\n' + indexDates.map(date => `[${date}](#${date})`).join('\n') + '\n';
  logContent = logContent.replace(indexPattern, newIndex);

  // Ensure a blank line after index
  logContent = logContent.replace(/(## Index[\s\S]*?)(?=\n## |$)/, (m) => m.endsWith('\n\n') ? m : m + '\n');

  // Append or update log for the specified date
  const dateSectionPattern = new RegExp(`## ${today}([\\s\\S]*?)(?=## |$)`);
  const newLogContent = `## ${today}\n1. What I did:\n` +
    answers.whatIDid.map(p => SPACE_4_CHAR +`- ${p}`).join('\n') + '\n' +
    `2. What's next:\n` +
    answers.whatsNext.map(p => SPACE_4_CHAR + `- ${p}`).join('\n') + '\n' +
    `3. What Block:\n` +
    answers.whatBlock.map(p => SPACE_4_CHAR + `- ${p}`).join('\n') + '\n' +
    `4. Productivity Score (1-5): ${answers.productivityScore}\n`;

  if (dateSectionPattern.test(logContent)) {
    logContent = logContent.replace(dateSectionPattern, newLogContent);
  } else {
    logContent += `\n${newLogContent}`;
  }

  // Update gist
  await octokit.gists.update({
    gist_id: GIST_ID,
    files: {
      [LOG_FILENAME]: { content: logContent },
    },
  });
  console.log(`Log ${isUpdated ? 'updated' : 'added'} ✍  for ${today} in Gist ✌`);
}

main();
