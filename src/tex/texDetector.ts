import { execFile } from 'node:child_process';

export type TexStatus = 'OK' | 'MISSING_TEX' | 'MISSING_LATEXMK' | 'UNKNOWN_ERROR';

export interface TexDetectionResult {
	status: TexStatus;
	details: string;
	versions?: {
		latexmk?: string;
		pdflatex?: string;
	};
	errors?: string[];
}

type ExecResult = {
	stdout: string;
	stderr: string;
	exitCode: number | null;
	error?: NodeJS.ErrnoException;
};

function execVersion(command: string, args: string[] = ['--version']): Promise<ExecResult> {
	return new Promise((resolve) => {
		execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
			const exitCode = typeof (error as { code?: number })?.code === 'number'
				? (error as { code?: number }).code
				: 0;
			resolve({
				stdout: stdout ?? '',
				stderr: stderr ?? '',
				exitCode: exitCode ?? null,
				error: error as NodeJS.ErrnoException | undefined
			});
		});
	});
}

function firstLine(value: string): string {
	const line = value.split(/\r?\n/)[0]?.trim();
	return line ?? '';
}

export async function detectTex(): Promise<TexDetectionResult> {
	const errors: string[] = [];
	const versions: { latexmk?: string; pdflatex?: string } = {};

	const latexmkResult = await execVersion('latexmk');
	const latexmkMissing = latexmkResult.error?.code === 'ENOENT';
	if (!latexmkMissing && latexmkResult.stdout) {
		versions.latexmk = firstLine(latexmkResult.stdout);
	} else if (latexmkMissing) {
		errors.push('latexmk not found in PATH.');
	} else if (latexmkResult.error) {
		errors.push(`latexmk error: ${latexmkResult.error.message}`);
	}

	const engines = ['pdflatex', 'xelatex', 'lualatex'];
	let engineFound = false;
	for (const engine of engines) {
		const engineResult = await execVersion(engine);
		const engineMissing = engineResult.error?.code === 'ENOENT';
		if (engineMissing) {
			errors.push(`${engine} not found in PATH.`);
			continue;
		}
		if (engineResult.error) {
			errors.push(`${engine} error: ${engineResult.error.message}`);
			continue;
		}
		engineFound = true;
		if (engineResult.stdout) {
			versions.pdflatex = firstLine(engineResult.stdout);
		}
		break;
	}

	if (!engineFound) {
		return {
			status: 'MISSING_TEX',
			details: 'No TeX engine detected in PATH.',
			versions: Object.keys(versions).length ? versions : undefined,
			errors: errors.length ? errors : undefined
		};
	}

	if (latexmkMissing) {
		return {
			status: 'MISSING_LATEXMK',
			details: 'TeX engine detected, but latexmk is missing.',
			versions: Object.keys(versions).length ? versions : undefined,
			errors: errors.length ? errors : undefined
		};
	}

	if (latexmkResult.error) {
		return {
			status: 'UNKNOWN_ERROR',
			details: 'Unexpected error while checking latexmk.',
			versions: Object.keys(versions).length ? versions : undefined,
			errors: errors.length ? errors : undefined
		};
	}

	return {
		status: 'OK',
		details: 'TeX engine and latexmk detected.',
		versions: Object.keys(versions).length ? versions : undefined,
		errors: errors.length ? errors : undefined
	};
}
