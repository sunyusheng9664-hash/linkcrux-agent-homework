'use strict'

exports.main = async (...args) => {
  const { main } = require('./dist/index.js')
  return main(...args)
}
