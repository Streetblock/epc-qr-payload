const SERVICE_TAG = 'BCD'
const DEFAULT_VERSION = '002'
const DEFAULT_CHARSET = '1'
const DEFAULT_IDENTIFICATION = 'SCT'
const DEFAULT_LINE_ENDING = '\n'
const MAX_PAYLOAD_BYTES = 331

const CHARACTER_SETS = {
  1: { id: '1', label: 'utf-8', name: 'UTF-8' },
  2: { id: '2', label: 'iso-8859-1', name: 'ISO 8859-1' },
  3: { id: '3', label: 'iso-8859-2', name: 'ISO 8859-2' },
  4: { id: '4', label: 'iso-8859-4', name: 'ISO 8859-4' },
  5: { id: '5', label: 'iso-8859-5', name: 'ISO 8859-5' },
  6: { id: '6', label: 'iso-8859-7', name: 'ISO 8859-7' },
  7: { id: '7', label: 'iso-8859-10', name: 'ISO 8859-10' },
  8: { id: '8', label: 'iso-8859-15', name: 'ISO 8859-15' },
}

const ISO_ENCODER_CACHE = new Map()

export class EpcCore {
  static QR_OPTIONS = Object.freeze({
    errorCorrectionLevel: 'M',
    maxVersion: 13,
  })

  static create(input, options = {}) {
    const model = normalizePayment(input, options)
    const payload = serializePayment(model, options)
    const bytes = encodePayload(payload, model.characterSet)
    validatePayloadSize(bytes)

    return {
      payload,
      bytes,
      model,
      qrOptions: { ...EpcCore.QR_OPTIONS },
    }
  }

  static serialize(input, options = {}) {
    return EpcCore.create(input, options).payload
  }

  static parse(payload, options = {}) {
    const text = normalizePayloadInput(payload, options.characterSet)
    const lineEnding = detectLineEnding(text)
    const lines = text.split(lineEnding)
    const warnings = []

    if (lines[0] !== SERVICE_TAG) {
      throw new EpcValidationError('serviceTag', 'EPC payload must start with BCD.')
    }

    if (lines.length < 7 || lines.length > 12) {
      throw new EpcValidationError('payload', 'EPC payload must contain between 7 and 12 lines.')
    }

    const padded = [...lines]
    while (padded.length < 12) padded.push('')

    const model = normalizePayment({
      version: padded[1],
      characterSet: padded[2],
      identification: padded[3],
      bic: padded[4],
      name: padded[5],
      iban: padded[6],
      amount: padded[7],
      purpose: padded[8],
      remittanceReference: padded[9],
      remittanceText: padded[10],
      information: padded[11],
    }, { ...options, allowInstant: true })

    if (model.identification === 'INST') {
      warnings.push('INST is outside strict EPC069-12 v3.1; SCT is the fixed identification code.')
    }

    return {
      ...model,
      lineEnding,
      warnings,
    }
  }

  static encode(text, characterSet = DEFAULT_CHARSET) {
    return encodePayload(text, characterSet)
  }

  static decode(bytes, characterSet = DEFAULT_CHARSET) {
    return decodePayload(bytes, characterSet)
  }

  static validate(input, options = {}) {
    EpcCore.create(input, options)
    return true
  }
}

export class EpcValidationError extends Error {
  constructor(field, message) {
    super(message)
    this.name = 'EpcValidationError'
    this.field = field
  }
}

export function serializePayment(input, options = {}) {
  const model = normalizePayment(input, options)
  const lineEnding = normalizeLineEnding(options.lineEnding)
  const lines = [
    SERVICE_TAG,
    model.version,
    model.characterSet,
    model.identification,
    model.bic,
    model.name,
    model.iban,
    model.amount,
    model.purpose,
    model.remittanceReference,
    model.remittanceText,
    model.information,
  ]

  return trimTrailingEmptyLines(lines).join(lineEnding)
}

export function normalizePayment(input, options = {}) {
  if (!input || typeof input !== 'object') {
    throw new EpcValidationError('payment', 'Payment data must be an object.')
  }

  const model = {
    version: normalizeFixed(input.version ?? DEFAULT_VERSION, 'version'),
    characterSet: normalizeFixed(input.characterSet ?? DEFAULT_CHARSET, 'characterSet'),
    identification: normalizeFixed(input.identification ?? DEFAULT_IDENTIFICATION, 'identification'),
    bic: normalizeText(input.bic ?? '', 'bic').toUpperCase(),
    name: normalizeText(input.name, 'name'),
    iban: normalizeIban(input.iban),
    amount: normalizeAmount(input.amount ?? ''),
    purpose: normalizeText(input.purpose ?? '', 'purpose').toUpperCase(),
    remittanceReference: normalizeText(input.remittanceReference ?? input.reference ?? '', 'remittanceReference').toUpperCase(),
    remittanceText: normalizeText(input.remittanceText ?? input.text ?? '', 'remittanceText'),
    information: normalizeText(input.information ?? '', 'information'),
  }

  validateVersion(model.version)
  validateCharacterSet(model.characterSet)
  validateIdentification(model.identification, options)
  validateBic(model.bic, model.version)
  validateLength('name', model.name, 1, 70)
  validateIban(model.iban)
  if (model.amount) validateAmount(model.amount)
  validateLength('purpose', model.purpose, 0, 4)
  validatePurpose(model.purpose)
  validateRemittance(model.remittanceReference, model.remittanceText)
  validateLength('information', model.information, 0, 70)
  validateEncodableFields(model)

  return model
}

export function encodePayload(text, characterSet = DEFAULT_CHARSET) {
  const id = normalizeCharacterSetId(characterSet)

  if (id === '1') {
    return new TextEncoder().encode(text)
  }

  return getIsoCodec(id).encode(text)
}

export function decodePayload(bytes, characterSet = DEFAULT_CHARSET) {
  const id = normalizeCharacterSetId(characterSet)
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)

  if (id === '1') {
    return new TextDecoder('utf-8', { fatal: true }).decode(input)
  }

  return getIsoCodec(id).decode(input)
}

export function isEncodable(text, characterSet = DEFAULT_CHARSET) {
  try {
    encodePayload(text, characterSet)
    return true
  } catch {
    return false
  }
}

function normalizePayloadInput(payload, fallbackCharacterSet = DEFAULT_CHARSET) {
  if (typeof payload === 'string') return payload
  if (payload instanceof Uint8Array || Array.isArray(payload)) {
    const bytes = payload instanceof Uint8Array ? payload : Uint8Array.from(payload)
    return decodePayload(bytes, detectCharacterSetFromBytes(bytes, fallbackCharacterSet))
  }
  throw new EpcValidationError('payload', 'Payload must be a string or byte array.')
}

function detectCharacterSetFromBytes(bytes, fallbackCharacterSet) {
  const lines = []
  let current = ''

  for (let i = 0; i < bytes.length && lines.length < 3; i += 1) {
    const byte = bytes[i]
    if (byte === 0x0d) continue
    if (byte === 0x0a) {
      lines.push(current)
      current = ''
      continue
    }
    if (byte > 0x7f) break
    current += String.fromCharCode(byte)
  }

  if (lines.length < 3 && current) lines.push(current)
  return lines[0] === SERVICE_TAG && lines[2] ? lines[2] : fallbackCharacterSet
}

function detectLineEnding(text) {
  const hasCrLf = text.includes('\r\n')
  const hasLf = text.includes('\n')
  if (hasCrLf && text.replace(/\r\n/g, '').includes('\n')) {
    throw new EpcValidationError('lineEnding', 'Line endings must be consistent.')
  }
  return hasCrLf ? '\r\n' : hasLf ? '\n' : DEFAULT_LINE_ENDING
}

function normalizeLineEnding(lineEnding = DEFAULT_LINE_ENDING) {
  if (lineEnding !== '\n' && lineEnding !== '\r\n') {
    throw new EpcValidationError('lineEnding', 'Line ending must be LF or CRLF.')
  }
  return lineEnding
}

function trimTrailingEmptyLines(lines) {
  const result = [...lines]
  while (result.length > 0 && result[result.length - 1] === '') result.pop()
  return result
}

function normalizeFixed(value, field) {
  return normalizeText(value, field).toUpperCase()
}

function normalizeText(value, field) {
  if (value === undefined || value === null) {
    throw new EpcValidationError(field, `${field} is required.`)
  }
  const text = String(value).trim()
  if (/[\r\n]/.test(text)) {
    throw new EpcValidationError(field, `${field} must not contain line breaks.`)
  }
  return text
}

function normalizeIban(value) {
  return normalizeText(value, 'iban').replace(/\s+/g, '').toUpperCase()
}

function normalizeAmount(value) {
  if (value === '' || value === null || value === undefined) return ''
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new EpcValidationError('amount', 'Amount must be a finite number.')
    }
    return `EUR${value.toFixed(2)}`
  }

  const raw = String(value).trim()
  if (raw.includes(',')) {
    throw new EpcValidationError('amount', 'Amount must use a dot as decimal separator.')
  }
  if (/^\d+(\.\d{1,2})?$/.test(raw)) {
    return `EUR${Number(raw).toFixed(2)}`
  }
  if (/^EUR\d+(\.\d{1,2})?$/.test(raw)) {
    const numeric = raw.slice(3)
    return `EUR${Number(numeric).toFixed(2)}`
  }
  return raw
}

function validateVersion(version) {
  if (version !== '001' && version !== '002') {
    throw new EpcValidationError('version', 'Version must be 001 or 002.')
  }
}

function validateCharacterSet(characterSet) {
  if (!CHARACTER_SETS[characterSet]) {
    throw new EpcValidationError('characterSet', 'Character set must be one of 1..8.')
  }
}

function validateIdentification(identification, options = {}) {
  const allowed = options.allowInstant ? ['SCT', 'INST'] : ['SCT']
  if (!allowed.includes(identification)) {
    throw new EpcValidationError('identification', `Identification must be ${allowed.join(' or ')}.`)
  }
}

function validateBic(bic, version) {
  if (!bic && version === '001') {
    throw new EpcValidationError('bic', 'BIC is mandatory for version 001.')
  }
  if (!bic) return
  if (!/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(bic)) {
    throw new EpcValidationError('bic', 'BIC must contain 8 or 11 uppercase letters/digits.')
  }
}

function validateLength(field, value, min, max) {
  const length = [...value].length
  if (length < min || length > max) {
    throw new EpcValidationError(field, `${field} must be between ${min} and ${max} characters.`)
  }
}

function validateIban(iban) {
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) {
    throw new EpcValidationError('iban', 'IBAN format is invalid.')
  }
  if (iban.length < 15 || iban.length > 34 || mod97(iban.slice(4) + iban.slice(0, 4)) !== 1) {
    throw new EpcValidationError('iban', 'IBAN checksum is invalid.')
  }
}

function validateAmount(amount) {
  if (!/^EUR\d{1,9}\.\d{2}$/.test(amount)) {
    throw new EpcValidationError('amount', 'Amount must use the format EUR#.##.')
  }
  const value = Number(amount.slice(3))
  if (value < 0.01 || value > 999999999.99) {
    throw new EpcValidationError('amount', 'Amount must be between EUR0.01 and EUR999999999.99.')
  }
}

function validatePurpose(purpose) {
  if (purpose && !/^[A-Z0-9]{1,4}$/.test(purpose)) {
    throw new EpcValidationError('purpose', 'Purpose must contain up to 4 uppercase letters/digits.')
  }
}

function validateRemittance(reference, text) {
  if (reference && text) {
    throw new EpcValidationError('remittanceReference', 'Structured reference and remittance text are mutually exclusive.')
  }
  validateLength('remittanceReference', reference, 0, 25)
  validateLength('remittanceText', text, 0, 140)
  if (reference) validateCreditorReference(reference)
}

function validateCreditorReference(reference) {
  if (!/^RF[0-9]{2}[A-Z0-9]{1,21}$/.test(reference)) {
    throw new EpcValidationError('remittanceReference', 'Structured reference must be an ISO 11649 RF creditor reference.')
  }
  if (mod97(reference.slice(4) + reference.slice(0, 4)) !== 1) {
    throw new EpcValidationError('remittanceReference', 'Structured reference checksum is invalid.')
  }
}

function validateEncodableFields(model) {
  const payload = serializeFieldsForEncodingCheck(model)
  encodePayload(payload, model.characterSet)
}

function validatePayloadSize(bytes) {
  if (bytes.length > MAX_PAYLOAD_BYTES) {
    throw new EpcValidationError('payload', `Payload must not exceed ${MAX_PAYLOAD_BYTES} bytes.`)
  }
}

function serializeFieldsForEncodingCheck(model) {
  return [
    SERVICE_TAG,
    model.version,
    model.characterSet,
    model.identification,
    model.bic,
    model.name,
    model.iban,
    model.amount,
    model.purpose,
    model.remittanceReference,
    model.remittanceText,
    model.information,
  ].join('\n')
}

function mod97(input) {
  let remainder = 0
  for (const char of input.toUpperCase()) {
    const value = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char
    for (const digit of value) {
      if (!/[0-9]/.test(digit)) {
        throw new EpcValidationError('checksum', 'Checksum input contains invalid characters.')
      }
      remainder = (remainder * 10 + Number(digit)) % 97
    }
  }
  return remainder
}

function normalizeCharacterSetId(characterSet) {
  const raw = String(characterSet).trim().toLowerCase()
  const matched = Object.values(CHARACTER_SETS).find((entry) => (
    entry.id === raw || entry.label === raw || entry.name.toLowerCase().replace(/\s+/g, '-') === raw
  ))
  if (!matched) {
    throw new EpcValidationError('characterSet', 'Character set must be one of 1..8.')
  }
  return matched.id
}

function getIsoCodec(characterSet) {
  const id = normalizeCharacterSetId(characterSet)
  if (ISO_ENCODER_CACHE.has(id)) return ISO_ENCODER_CACHE.get(id)

  const meta = CHARACTER_SETS[id]
  const decodeMap = buildDecodeMap(meta)
  const encodeMap = new Map()
  decodeMap.forEach((char, byte) => {
    if (!encodeMap.has(char)) encodeMap.set(char, byte)
  })

  const codec = {
    encode(text) {
      const output = []
      for (const char of text) {
        const byte = encodeMap.get(char)
        if (byte === undefined) {
          throw new EpcValidationError('characterSet', `Character "${char}" is not encodable in ${meta.name}.`)
        }
        output.push(byte)
      }
      return Uint8Array.from(output)
    },
    decode(bytes) {
      let text = ''
      for (const byte of bytes) {
        const char = decodeMap[byte]
        if (char === undefined) {
          throw new EpcValidationError('characterSet', `Byte 0x${byte.toString(16)} is not decodable in ${meta.name}.`)
        }
        text += char
      }
      return text
    },
  }

  ISO_ENCODER_CACHE.set(id, codec)
  return codec
}

function buildDecodeMap(meta) {
  if (meta.id === '2') {
    return Array.from({ length: 256 }, (_, byte) => String.fromCodePoint(byte))
  }

  const bytes = Uint8Array.from({ length: 256 }, (_, byte) => byte)
  const decoder = new TextDecoder(meta.label, { fatal: false })
  return [...decoder.decode(bytes)]
}
