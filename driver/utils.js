export const parseSelectors = selector => {
  return Array.isArray(selector) ? selector : selector.split('>>').map(ele => {
    const holders = [...ele.matchAll(/\[\[[^\]]+\]\]/g)].map(m => m[0])
    const options = {}
    holders.forEach(t => {
      ele = ele.replace(t, '')
      const parts = t.slice(2, -2).split('; ')
      parts.forEach(p => {
        let [key, value] = p.split('=')
        if (key === 'nth') value *= 1
        options[key] = value
      })
    })
    return [ele, options]
  })
}

export const chainLocator = (locator, options) => {
  if ('text' in options) {
    locator = locator.getByText(options.text)
  } else if ('eText' in options) {
    locator = locator.getByText(options.text, { exact: true })
  }
  locator = locator.nth(options.nth || 0)
  return locator
}

export const isUrlMatch = (url, pattern) => {
  if (Array.isArray(pattern)) return pattern.some(p => isUrlMatch(url, p))
  if (pattern instanceof RegExp) return pattern.test(url)
  return pattern === url
}

export const onError = (err, executor, label = '') => {
  const log = executor.log || console.log
  let message
  if (err?.stack) {
    message = '[Error]: ' + err.stack.toString()
  } else if (err?.message) {
    message = '[Error]: ' + err.message.toString()
  } else {
    message = '[Error]: ' + err?.toString()
  }
  log('[Error]: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx -- ' + label)
  log(message)
  executor.comment(message, {
    backgroundColor: 'red',
    cssText: 'position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 999999; font-size: 20px;'
  })
}

export default {
  parseSelectors,
  chainLocator,
  isUrlMatch,
  onError
}
