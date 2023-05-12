import bcrypt from 'bcryptjs'

let salt = ''

export const genSalt = () => {
  if (salt) {
    return salt
  }
  return new Promise(resolve => {
    bcrypt.genSalt(10, (err, st) => {
      salt = err ? Date.now().toString(16) : st
      resolve(salt)
    })
  })
}

export const encrypt = async raw => {
  const salt = await genSalt()
  return new Promise((resolve, reject) => {
    bcrypt.hash(raw, salt, (err, hash) => {
      err ? reject(err) : resolve(hash)
    })
  })
}

export const validate = (raw, hash) => {
  return bcrypt.compare(raw, hash)
}

export default {
  genSalt,
  encrypt,
  validate
}
