'use strict'

/* eslint-disable no-console */

const http = require('http')
const os = require('os')

const bodyParser = require('body-parser')
const express = require('express')
const mongoose = require('mongoose')
const morgan = require('morgan')
const Raven = require('raven')
const io = require('socket.io')
const cha = require('cha-price')
const webpush = require('web-push')
const terminus = require('@godaddy/terminus')
const helmet = require('helmet')

const pkg = require('../package.json')

const vapidKeys = {
  publicKey: process.env.VAPID_PRIVATE_KEY,
  privateKey: process.env.VAPID_PUBLIC_KEY
}

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  vapidKeys.publicKey,
  vapidKeys.privateKey
)

// Conexion de mongodb
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost/cha-notifier')
mongoose.Promise = global.Promise

// Instancia de express
const app = express()
const server = http.createServer(app)

// Cliente de sentry para notificar errores de produccion
const ravenOptions = {
  release: pkg.version,
  environment: process.env.NODE_ENV || 'development',
  server_name: process.env.HOSTNAME || os.hostname(),
  captureUnhandledRejections: true,
  autoBreadcrumbs: true
}
Raven.config(process.env.SENTRY_TOKEN, ravenOptions).install()
app.use(Raven.requestHandler())

// Mejorar seguridad
app.use(helmet())
app.disable('x-powered-by')

/**
 * Metodo encargado ejecutar tareas previas a terminar la aplicación
 */
async function onSignal () {
  await mongoose.connection.close()
}

/**
 * Metodo encargado de verificar que la aplicación este viva
 */
function onHealthCheck () {
  return mongoose.connection.readyState === 1
}

const options = {
  healthChecks: { '/healthcheck': onHealthCheck },
  timeout: 1000,
  signal: process.env.HEALTHCHECK_SIGNAL || 'SIGINT',
  onSignal
}
terminus(server, options)

// Logger
app.use(morgan('dev'))
const logError = err => {
  if (process.env.NODE_ENV === 'production') {
    Raven.captureException(err)
  }
  console.error(err)
}

// Parser de peticiones POST
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

// Modelos
const SubscriptionSchema = new mongoose.Schema({
  endpoint: String,
  keys: {
    p256dh: String,
    auth: String
  }
})
const Subscription = mongoose.model('Subscription', SubscriptionSchema)

// Rutas
app.use((req, res, next) => {
  res.setHeader(
    'Access-Control-Allow-Origin',
    process.env.ACCESS_CONTROL_ALLOW_ORIGIN || '*'
  )
  res.setHeader(
    'Access-Control-Allow-Methods',
    process.env.ACCESS_CONTROL_ALLOW_METHODS ||
      'GET,POST,OPTIONS,PUT,PATCH,DELETE'
  )
  res.setHeader(
    'Access-Control-Allow-Headers',
    process.env.ACCESS_CONTROL_ALLOW_HEADERS || 'X-Requested-With,content-type'
  )
  res.setHeader(
    'Access-Control-Allow-Credentials',
    process.env.ACCESS_CONTROL_ALLOW_CREDENTIALS !== 'false'
  )
  next()
})

const triggerPushMsg = (subscription, dataToSend) => {
  const mySub = {
    endpoint: subscription.endpoint,
    keys: {
      auth: subscription.keys.auth,
      p256dh: subscription.keys.p256dh
    }
  }
  return webpush.sendNotification(mySub, dataToSend).catch(logError)
}

app.get('/api/price/', (req, res, next) => {
  return cha()
    .then(price => {
      return Subscription.find({})
        .exec()
        .then(subscriptions => {
          let promiseChain = Promise.resolve()
          subscriptions.forEach(subscription => {
            promiseChain = promiseChain.then(() => {
              return triggerPushMsg(subscription, price.toString())
            })
          })
          return promiseChain
        })
        .then(() => {
          socketIO.sockets.emit('price', price)
          res.json(price)
        })
    })
    .catch(next)
})

const saveSubscriptionToDatabase = data => {
  const doc = new Subscription(data)
  return doc.save()
}

app.post('/api/save-subscription/', (req, res, next) => {
  if (!req.body.endpoint || !req.body.keys) {
    return res.sendStatus(400)
  }

  return saveSubscriptionToDatabase(req.body)
    .then(subscription => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ data: { success: true } }))
    })
    .catch(next)
})

// Socket.io
const socketIO = io(server)
socketIO.on('connection', socket => socket.emit('hello'))

// Error logger
app.use(Raven.errorHandler())
app.use((err, req, res, next) => {
  if (
    err.message &&
    (~err.message.indexOf('not found') ||
      ~err.message.indexOf('Cast to ObjectId failed'))
  ) {
    next()
  } else {
    logError(err)
    res.status(500)
  }
})
app.use((req, res) => {
  res.status(404)
})

process.on('unhandledRejection', logError)

const port = process.env.PORT || 3000
server.listen(port, () => {
  console.log(`Express app started on port ${port}`)
})

module.exports = server
