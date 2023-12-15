
export const name = text => {
  if (!text || text.length < 2) return text
  if (text.length === 2) return text[0] + '*'
  return text[0] + new Array(text.length - 2).fill('*').join('') + text[text.length - 1]
}

export const phone = text => {
  if (!text) return text
  return text.slice(0, 3) + '****' + text.slice(-4)
}

export const email = text => {
  if (!text) return text
  return text.slice(0, 2) + '****@' + text.split('@').pop()
}

export const idcard = text => {
  if (!text) return text
  return text.slice(0, 4) + new Array(text.length - 8).fill('*').join('') + text.slice(-4)
}

export default {
  name,
  phone,
  email,
  idcard
}
