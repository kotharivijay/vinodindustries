/// <reference types="web-bluetooth" />

// ESC/POS command constants
const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

const COMMANDS = {
  INIT: new Uint8Array([ESC, 0x40]),
  BOLD_ON: new Uint8Array([ESC, 0x45, 0x01]),
  BOLD_OFF: new Uint8Array([ESC, 0x45, 0x00]),
  ALIGN_CENTER: new Uint8Array([ESC, 0x61, 0x01]),
  ALIGN_LEFT: new Uint8Array([ESC, 0x61, 0x00]),
  ALIGN_RIGHT: new Uint8Array([ESC, 0x61, 0x02]),
  FONT_NORMAL: new Uint8Array([GS, 0x21, 0x00]),
  FONT_DOUBLE_HEIGHT: new Uint8Array([GS, 0x21, 0x01]),
  FONT_DOUBLE_WIDTH: new Uint8Array([GS, 0x21, 0x10]),
  FONT_DOUBLE: new Uint8Array([GS, 0x21, 0x11]),
  FONT_LARGE: new Uint8Array([GS, 0x21, 0x11]),
  LINE_FEED: new Uint8Array([LF]),
  CUT: new Uint8Array([GS, 0x56, 0x00]),
  PARTIAL_CUT: new Uint8Array([GS, 0x56, 0x01]),
  UNDERLINE_ON: new Uint8Array([ESC, 0x2d, 0x01]),
  UNDERLINE_OFF: new Uint8Array([ESC, 0x2d, 0x00]),
  FEED_LINES: (n: number) => new Uint8Array([ESC, 0x64, n]),
}

const encoder = new TextEncoder()

class BluetoothPrinter {
  private device: BluetoothDevice | null = null
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null
  private connected = false

  private static SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb'

  // All known thermal printer service UUIDs
  private static ALL_SERVICE_UUIDS = [
    '000018f0-0000-1000-8000-00805f9b34fb',
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    '0000ff00-0000-1000-8000-00805f9b34fb',
    '0000ffe0-0000-1000-8000-00805f9b34fb',
    '00001101-0000-1000-8000-00805f9b34fb',
    '0000fee7-0000-1000-8000-00805f9b34fb',
  ]

  async connect(): Promise<boolean> {
    try {
      // Show ALL Bluetooth devices — user picks their printer
      this.device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: BluetoothPrinter.ALL_SERVICE_UUIDS,
      })

      const server = await this.device.gatt!.connect()

      // Try each known service UUID to find a writable characteristic
      for (const serviceUuid of BluetoothPrinter.ALL_SERVICE_UUIDS) {
        try {
          const service = await server.getPrimaryService(serviceUuid)
          const chars = await service.getCharacteristics()
          for (const char of chars) {
            if (char.properties.write || char.properties.writeWithoutResponse) {
              this.characteristic = char
              this.connected = true
              return true
            }
          }
        } catch {
          continue
        }
      }

      // Last resort: try discovering all services
      try {
        const services = await server.getPrimaryServices()
        for (const service of services) {
          try {
            const chars = await service.getCharacteristics()
            for (const char of chars) {
              if (char.properties.write || char.properties.writeWithoutResponse) {
                this.characteristic = char
                this.connected = true
                return true
              }
            }
          } catch { continue }
        }
      } catch {}

      throw new Error('No writable characteristic found on this device')
    } catch (err: unknown) {
      console.error('Bluetooth connect error:', err)
      this.connected = false
      throw err
    }
  }

  async disconnect() {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect()
    }
    this.connected = false
    this.device = null
    this.characteristic = null
  }

  isConnected(): boolean {
    return this.connected && !!this.characteristic
  }

  getDeviceName(): string | null {
    return this.device?.name ?? null
  }

  private async sendBytes(data: Uint8Array) {
    if (!this.characteristic) throw new Error('Not connected')
    const CHUNK = 100
    for (let i = 0; i < data.length; i += CHUNK) {
      const chunk = data.slice(i, i + CHUNK)
      if (this.characteristic.properties.writeWithoutResponse) {
        await this.characteristic.writeValueWithoutResponse(chunk)
      } else {
        await this.characteristic.writeValueWithResponse(chunk)
      }
      await new Promise(r => setTimeout(r, 20))
    }
  }

  async sendCommand(cmd: Uint8Array) {
    await this.sendBytes(cmd)
  }

  async printText(text: string) {
    await this.sendBytes(encoder.encode(text))
    await this.sendCommand(COMMANDS.LINE_FEED)
  }

  async printLine(text: string, bold = false, size: 'normal' | 'large' | 'double-height' | 'double-width' = 'normal') {
    if (bold) await this.sendCommand(COMMANDS.BOLD_ON)
    switch (size) {
      case 'large': await this.sendCommand(COMMANDS.FONT_LARGE); break
      case 'double-height': await this.sendCommand(COMMANDS.FONT_DOUBLE_HEIGHT); break
      case 'double-width': await this.sendCommand(COMMANDS.FONT_DOUBLE_WIDTH); break
      default: await this.sendCommand(COMMANDS.FONT_NORMAL)
    }
    await this.sendBytes(encoder.encode(text))
    await this.sendCommand(COMMANDS.LINE_FEED)
    if (bold) await this.sendCommand(COMMANDS.BOLD_OFF)
    await this.sendCommand(COMMANDS.FONT_NORMAL)
  }

  async printCentered(text: string, bold = false, size: 'normal' | 'large' = 'normal') {
    await this.sendCommand(COMMANDS.ALIGN_CENTER)
    await this.printLine(text, bold, size)
    await this.sendCommand(COMMANDS.ALIGN_LEFT)
  }

  async printDivider(char = '-', width = 32) {
    await this.printText(char.repeat(width))
  }

  async printKeyValue(key: string, value: string, width = 32) {
    const padding = width - key.length - value.length
    const line = key + ' '.repeat(Math.max(1, padding)) + value
    await this.printText(line)
  }

  async feedLines(n = 3) {
    await this.sendCommand(COMMANDS.FEED_LINES(n))
  }

  async cut() {
    await this.feedLines(3)
    await this.sendCommand(COMMANDS.PARTIAL_CUT)
  }

  async init() {
    await this.sendCommand(COMMANDS.INIT)
  }
}

export { BluetoothPrinter, COMMANDS }
