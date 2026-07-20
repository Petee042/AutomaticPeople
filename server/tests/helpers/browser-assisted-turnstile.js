'use strict';

const puppeteer = require('puppeteer');

function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

async function captureTurnstileToken(optionsInput) {
  const options = Object.assign({
    baseUrl: 'https://automaticpeople-alpha.onrender.com',
    timeoutMs: 5 * 60 * 1000,
    signupPath: '/index.html'
  }, optionsInput || {});

  const baseUrl = normalizeUrl(options.baseUrl);
  const targetUrl = baseUrl + String(options.signupPath || '/index.html');
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null
  });

  try {
    const page = await browser.newPage();
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: options.timeoutMs });
    await page.waitForSelector('[data-tab="signup"]', { timeout: options.timeoutMs });
    await page.click('[data-tab="signup"]');
    await page.waitForSelector('#signupForm', { timeout: options.timeoutMs });
    await page.waitForSelector('#signup-turnstile', { timeout: options.timeoutMs });

    console.log('');
    console.log('Browser-assisted Turnstile helper opened at: ' + targetUrl);
    console.log('1. In the opened browser, stay on the Sign Up tab.');
    console.log('2. Complete the Turnstile check manually.');
    console.log('3. Do not submit the signup form.');
    console.log('4. This helper will continue automatically once the token is present.');
    console.log('');

    await page.waitForFunction(
      () => {
        const input = document.querySelector('#signupForm input[name="cf-turnstile-response"]');
        return Boolean(input && String(input.value || '').trim().length > 20);
      },
      { timeout: options.timeoutMs }
    );

    const token = await page.$eval(
      '#signupForm input[name="cf-turnstile-response"]',
      (input) => String(input && input.value || '').trim()
    );

    if (!token) {
      throw new Error('Turnstile token was not captured.');
    }

    console.log('Turnstile token captured successfully.');
    return token;
  } finally {
    await browser.close();
  }
}

module.exports = {
  captureTurnstileToken
};
