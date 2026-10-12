import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/** Git hooks run with the shell's default node, not the one `nvm use` picked,
 *  and native bindings are installed for the Node in .nvmrc. Returns the issue
 *  as a string with the fix (`fix` for a caller whose reader cannot run `nvm
 *  use`), or undefined when the version is fine or .nvmrc is not a version
 *  (`lts/*`, empty): only nvm can read those, so nothing is claimed. */
export function nodeVersionIssue(
	version: string,
	nvmrc: string,
	minimum = [22, 18],
	fix = 'Run `nvm use` (reads .nvmrc) and retry.',
) {
	const want = nvmrc.trim().replace(/^v/, '').split('.').map(Number)
	const [major = 0, minor = 0] = version.split('.').map(Number)
	const [wantMajor = minimum[0], wantMinor] = want
	if (!Number.isInteger(wantMajor)) return undefined
	const minMinor = wantMinor ?? (wantMajor === minimum[0] ? minimum[1]! : 0)
	if (major !== wantMajor || minor < minMinor) {
		return `node ${nvmrc.trim()} (>= ${wantMajor}.${minMinor}) required, have ${version}. ${fix}`
	}
	return undefined
}

export function checkNodeVersion(root: string) {
	const file = path.join(root, '.nvmrc')
	const nvmrc = existsSync(file) ? readFileSync(file, 'utf8') : '22'
	return nodeVersionIssue(process.versions.node, nvmrc)
}
