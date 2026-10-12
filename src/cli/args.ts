export type ParsedArgs = {
	command: string | undefined
	positionals: Array<string>
	flags: Set<string>
	options: Map<string, string>
}

/** `--name x` is an option (takes the next token); every other `--x` is a
 *  flag; the rest are positionals, in order. */
export function parseArgs(
	argv: ReadonlyArray<string>,
	valued: ReadonlyArray<string> = ['--name', '--base', '--timeout'],
): ParsedArgs {
	const [command, ...rest] = argv
	const positionals: Array<string> = []
	const flags = new Set<string>()
	const options = new Map<string, string>()
	for (let i = 0; i < rest.length; i++) {
		const token = rest[i]!
		if (valued.includes(token)) {
			const value = rest[i + 1]
			if (value === undefined || value.startsWith('--')) {
				throw new Error(`${token} needs a value`)
			}
			options.set(token, value)
			i++
		} else if (token.startsWith('--')) {
			flags.add(token)
		} else {
			positionals.push(token)
		}
	}
	return { command, positionals, flags, options }
}
