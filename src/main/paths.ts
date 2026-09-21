import { app } from 'electron'
import { join } from 'node:path'
export const userDataPath = (...p: string[]): string => join(app.getPath('userData'), ...p)
