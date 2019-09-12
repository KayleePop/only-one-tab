// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/

const test = require('muggle-test')
const assert = require('muggle-assert')
const puppeteer = require('puppeteer')

const sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// rejects after 10 seconds
async function rejectAfter10s (error) {
  await sleep(10 * 1000)
  throw error
}

async function runOnPage (page, asyncFunc) {
  // this html file loads ./bundle.js which is ./only-one-tab.js browserified
  // -r is used to allow window.require('only-one-tab') in other script
  await page.goto(`file://${require.resolve('./test.html')}`)

  return new Promise((resolve, reject) => {
    page.exposeFunction('resolveNodePromise', resolve)
      .then(() => page.exposeFunction('rejectNodePromise', reject))
      .then(() => page.addScriptTag({
        // immediately invoke passed function on the page and wait for it to resolve
        content:
        `(${asyncFunc.toString()})()
          .then(window.resolveNodePromise)
          .catch(window.rejectNodePromise)`
      }))
      .catch(reject)
  })
}

// returns tab object
// {
//   page: (puppeteer page for this tab),
//   isActing: (has the onlyOneTab callback been run yet?)
//   actingPromise: (promise for when the onlyOneTab callback runs)
// }
async function newTab (browser) {
  const page = await browser.newPage()

  const tab = {
    page: page,
    isActing: false
  }

  tab.actingPromise = runOnPage(page, async () => {
    const onlyOneTab = require('only-one-tab')

    await new Promise((resolve) => {
      onlyOneTab(() => {
        // console logs for debugging with devtools
        console.log('this tab started acting at ', new Date())

        resolve()
      })
    })
  })
  // .then is required because the above async function runs on the page not here
    .then(() => {
      // set isActing to true after the onlyOneTab() callback runs
      tab.isActing = true
    })

  return tab
}

test('a closing tab should successfully signal a new actor', async () => {
  const browser = await puppeteer.launch()

  const tabs = []

  // start with one tab
  tabs.push(await newTab(browser))

  // repeat to ensure consistency
  for (let i = 0; i < 100; i++) {
    // add one tab
    tabs.push(await newTab(browser))

    // wait for a tab to become actor
    await Promise.race([
      rejectAfter10s(new Error('timed out waiting for new tab to become actor')),
      ...tabs.map((tab) => tab.actingPromise)
    ])

    // close the acting tab and remove from tabs[]
    const actingIndex = tabs.findIndex((tab) => tab.isActing === true)
    await tabs[actingIndex].page.close({ runBeforeUnload: true })
    tabs.splice(actingIndex, 1)
  }

  browser.close()
})

test('there should be only one actor after opening many tabs concurrently', async () => {
  const browser = await puppeteer.launch()

  const openingTabs = []
  for (let i = 0; i < 200; i++) {
    // open in parallel to allow them to compete
    openingTabs.push(newTab(browser))
  }

  const tabs = await Promise.all(openingTabs)

  await Promise.race([
    rejectAfter10s(new Error('timed out waiting for new tab to become actor')),
    ...tabs.map((tab) => tab.actingPromise)
  ])

  const actingTabs = tabs.filter((tab) => tab.isActing === true)
  assert.equal(actingTabs.length, 1, 'there should be exactly one actor')

  browser.close()
})

// this reliably tests recovery from getting stuck
test('close all but one non-acting tab at once', async () => {
  const browser = await puppeteer.launch()

  // open 99 tabs
  const tabPromises = []
  for (let i = 0; i < 99; i++) {
    tabPromises.push(newTab(browser))
  }

  const tabsToClose = await Promise.all(tabPromises)

  // wait for an actor
  await Promise.race([
    rejectAfter10s(new Error('timed out waiting for initial tab to become actor')),
    ...tabsToClose.map((tab) => tab.actingPromise)
  ])

  const nonActor = await newTab(browser)

  // close all tabs but nonActor concurrently
  for (const tab of tabsToClose) {
    tab.page.close({ runBeforeUnload: true })
  }

  // wait for nonActor to act
  await Promise.race([
    rejectAfter10s(new Error('last tab should act')),
    nonActor.actingPromise
  ])

  browser.close()
})

test('should work when site is reopened', async () => {
  const browser = await puppeteer.launch()

  const tab = await newTab(browser)

  // wait for action
  await tab.actingPromise

  await tab.page.close({ runBeforeUnload: true })

  // make sure the last tab fully closes
  await sleep(100)

  const tab2 = await newTab(browser)

  await Promise.race([
    rejectAfter10s(new Error('timed out waiting for new tab to act')),
    tab2.actingPromise
  ])

  browser.close()
})

test('should recover from crash with exactly one actor', async () => {
  const browser = await puppeteer.launch()

  const crashTab = await newTab(browser)

  // wait until crashTab is the actor
  await crashTab.actingPromise

  crashTab.page.on('error', () => {}) // this prevents unhandled rejection from crash

  // simulate browser crash
  crashTab.page.goto('chrome://crash')
    .catch(() => {}) // swallow errors

  // allow heartbeat to time out
  await sleep(3 * 1000)

  const tabPromises = []
  for (let i = 0; i < 100; i++) {
    // open many tabs concurrently to ensure that the reset doesn't cause multiple actors
    tabPromises.push(newTab(browser))
  }

  const tabs = await Promise.all(tabPromises)

  // wait for an actor
  await Promise.race([
    rejectAfter10s(new Error('timed out waiting for new tab to act')),
    ...tabs.map((tab) => tab.actingPromise)
  ])

  // wait for any other tabs to start acting
  await sleep(2 * 1000)

  const actors = tabs.filter((tab) => tab.isActing === true)
  assert.equal(actors.length, 1, 'there should be exactly one actor')

  browser.close()
})

test('open a lot of tabs, then close each actor tab in sequence', async () => {
  const browser = await puppeteer.launch()

  const tabPromises = []
  for (let i = 0; i < 100; i++) {
    tabPromises.push(newTab(browser))
  }

  const tabs = await Promise.all(tabPromises)

  while (tabs.length > 0) {
    // wait for a tab to become actor
    await Promise.race([
      rejectAfter10s(new Error('timed out waiting for new tab to become actor')),
      ...tabs.map((tab) => tab.actingPromise)
    ])

    const actingTabs = tabs.filter((tab) => tab.isActing === true)
    assert.equal(actingTabs.length, 1, 'there should be exactly one actor')

    // close the acting tab and remove from tabs[]
    const actingIndex = actingTabs.findIndex((tab) => tab.isActing === true)
    await tabs[actingIndex].page.close({ runBeforeUnload: true })
    tabs.splice(actingIndex, 1)
  }

  browser.close()
})

test('open a lot of tabs, then close them randomly', async () => {
  const browser = await puppeteer.launch()

  const tabPromises = []
  for (let i = 0; i < 100; i++) {
    tabPromises.push(newTab(browser))
  }

  const tabs = await Promise.all(tabPromises)

  while (tabs.length > 0) {
    // wait until any tab is an actor
    await Promise.race([
      rejectAfter10s(new Error('timed out waiting for new tab to become actor')),
      ...tabs.map((tab) => tab.actingPromise)
    ])

    const actingTabs = tabs.filter((tab) => tab.isActing === true)
    assert.equal(actingTabs.length, 1, 'there should be exactly one actor')

    const randomTabIndex = Math.floor(Math.random() * tabs.length)

    // close random tab
    await tabs[randomTabIndex].page.close({ runBeforeUnload: true })

    // remove closed tab from tabs[]
    tabs.splice(randomTabIndex, 1)
  }

  browser.close()
})
