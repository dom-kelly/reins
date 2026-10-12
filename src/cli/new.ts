import { execFileSync, spawnSync } from 'node:child_process'
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { packageVersion, writeConfig } from '../lib/config.ts'
import { packageRoot } from '../lib/repo.ts'
import { applyTemplates, render } from '../lib/templates.ts'

export const scaffoldDir = path.join(packageRoot, 'scaffold', 'app-node')

/** reins new <dir>: a product repo with the placeholder app, every template,
 *  reins.json, git initialised and dependencies installed. */
export function createProduct(
	dir: string,
	{ name = path.basename(path.resolve(dir)), install = true, git = true } = {},
) {
	const root = path.resolve(dir)
	if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name)) {
		throw new Error(
			`"${name}" is not a valid npm package name; pass --name <lowercase-kebab>`,
		)
	}
	if (existsSync(root) && readdirSync(root).length > 0) {
		throw new Error(`${root} exists and is not empty`)
	}
	mkdirSync(root, { recursive: true })
	cpSync(scaffoldDir, root, { recursive: true })
	// npm renames a packed .gitignore to .npmignore, so the scaffold ships it undotted.
	renameSync(path.join(root, 'gitignore'), path.join(root, '.gitignore'))
	for (const file of ['package.json']) {
		const target = path.join(root, file)
		writeFileSync(target, render(readFileSync(target, 'utf8'), { name }))
	}
	const report = applyTemplates(root, { name }, { overwrite: true })
	writeConfig(root, { harness: packageVersion, product: { name } })
	if (git && !existsSync(path.join(root, '.git'))) {
		execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root })
	}
	if (install) {
		const result = spawnSync('npm', ['install'], {
			cwd: root,
			stdio: 'inherit',
		})
		if (result.status !== 0) throw new Error('npm install failed')
	}
	return { root, report }
}
