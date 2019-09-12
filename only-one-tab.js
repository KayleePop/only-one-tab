/* global localStorage */

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/

const { race, endRace } = require('tab-race')

const sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, ms))

module.exports = async function onlyOneTab (action) {
  const heartbeatKey = 'onlyOneTab-actor-heartbeat'
  const vacantKey = 'onlyOneTab-actor-status'
  const actorRaceId = 'onlyOneTab-actor-race'
  const resetRaceId = 'onlyOneTab-reset-race'
  const heartbeatInterval = 1000

  async function becomeActor () {
    action()

    localStorage.removeItem(vacantKey) // reset localStorage signal

    window.addEventListener('unload', () => {
      // endRace is synchronous
      // if it wasn't, then it wouldn't finish before the tab closed
      endRace(actorRaceId)

      // use 'storage' event to signal other tabs that the actor tab closed
      localStorage.setItem(vacantKey, 'vacant')

      // end reset race on close to ensure that recovery is always available
      endRace(resetRaceId)
    })

    // heartbeat for the active tab in case the actor race gets stuck
    // like a crash where unload handler isn't run
    while (true) {
      localStorage.setItem(heartbeatKey, new Date())
      await sleep(heartbeatInterval)
    }
  }

  // localStorage.setItem(vacantKey, 'vacant') signals the actor tab closed
  window.addEventListener('storage', async function handler (event) {
    if (event.key === vacantKey && event.newValue === 'vacant') {
      if (await race(actorRaceId)) {
        becomeActor()

        window.removeEventListener('storage', handler) // cleanup
      }
    }
  })

  // check if this tab should become actor
  // on start and then periodically to ensure nothing gets stuck
  // sometimes the 'storage' event doesn't fire
  // somtimes the actorRace randomly gets stuck
  while (true) {
    // actorRace lasts until actor tab is closed
    if (await race(actorRaceId)) {
      becomeActor()

      break // end periodic check since we're the actor now

    // reset if the last active tab closed without ending the actor race somehow
    } else if (isTimedOut()) {
      // multiple tabs may try to reset at once, so a race is necessary
      if (await race(resetRaceId)) {
        // no need to end the actorRace because this tab replaces the old winner
        becomeActor()

        // wait for heartbeat to start (no resets with active heartbeat)
        // also wait for any other resetters to finish to prevent multiple actors
        await sleep(1000)
        endRace(resetRaceId)

        break // end periodic check since we're the actor now
      }
    }

    // indexedDB operations are expensive, and things only get stuck very rarely
    await sleep(5 * 1000)
  }

  // returns a boolean for whether an old actor tab crashed
  // (closed without cleaning up and signalling for a new actor)
  function isTimedOut () {
    const lastHeartbeatString = localStorage.getItem(heartbeatKey)

    // if the key is null, then there was no previous actor.
    // not checking for this allows multiple actors when multiple tabs are
    // opened before the first actor makes a heartbeat
    // one wins the race and another wins the unnecessary reset
    if (lastHeartbeatString === null) {
      return false
    }

    const msSinceLastHeartbeat = new Date() - new Date(lastHeartbeatString)

    // times out after 3 missed heartbeats
    return (msSinceLastHeartbeat > heartbeatInterval * 3)
  }
}
