# Only One Tab

[![Node.js CI](https://github.com/KayleePop/only-one-tab/workflows/Node.js%20CI/badge.svg)](https://github.com/KayleePop/only-one-tab/actions)
[![standard badge](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com) 
[![npm](https://img.shields.io/npm/v/only-one-tab.svg)](https://www.npmjs.com/package/only-one-tab)

Run a function in exactly one open tab, switching to another if closed.

## Goals

- Robust across browsers
- Fully tested

## Usage

```javascript
const onlyOneTab = require('only-one-tab')

// only one daemon will run at a time across all tabs
onlyOneTab(() => {
  startDaemon()
})
```

## API

### `onlyOneTab(cb)`

The callback is run only once per tab, and on exactly one tab at a time. When the actor tab that ran the callback is closed, then exactly one other open tab runs its callback to replace it as the actor.

## Recovery

After a browser crash, or something similar, the actor tab can be closed without being replaced normally.

Every tab periodically checks for an active tab's heartbeat, and after 1-4 seconds, a new tab will become the actor to replace the crashed tab. A refresh or new tab will do the check immediately on startup as well.

If nothing goes wrong, a new actor replaces the closed tab immediately.
