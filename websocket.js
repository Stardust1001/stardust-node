import pako from 'pako'

export const gzip = data => {
  return pako.gzip(JSON.stringify(data), { to: 'string' })
}

export const ungzip = data => {
  return JSON.parse(pako.ungzip(new Uint8Array(data), { to: 'string' }))
}

const split = (data, maxBytes = 1e6) => {
  const gzipped = gzip(data)
  if (gzipped.length < maxBytes) {
    return [gzipped]
  } else {
    const total = Math.ceil(gzipped.length / maxBytes)
    const id = Date.now().toString(16)
    return Array.from({ length: total }).map((_, i) => {
      return {
        id,
        total,
        no: i + 1,
        data: gzipped.slice(i * maxBytes, (i + 1) * maxBytes)
      }
    })
  }
}

const slices = {}

const merge = data => {
  slices[data.id] = slices[data.id] || []
  slices[data.id].push(data)
  if (slices[data.id].length === data.total) {
    const numBytes = slices[data.id].reduce((sum, p) => sum + p.data.length, 0)
    const all = new Uint8Array(numBytes)
    let index = 0
    slices[data.id].forEach(p => {
      const array = p.data
      all.set(array, index)
      index += p.data.length
    })
    delete slices[data.id]
    return ungzip(all)
  }
}

export const gzipClient = client => {
  const on = client.on
  client.on = (command, func) => {
    on.apply(client, [command, async data => {
      if (['disconnect'].includes(command)) {
        func(data)
      } else if (data instanceof Buffer) {
        func(ungzip(data))
      } else {
        const merged = merge(data)
        merged && func(merged)
      }
    }])
  }

  const emit = client.emit
  client.emit = (command, message) => {
    const slices = split(message)
    slices.forEach(slice => {
      emit.apply(client, [command, slice])
    })
  }

  return client
}

export default {
  gzip,
  ungzip,
  gzipClient
}
