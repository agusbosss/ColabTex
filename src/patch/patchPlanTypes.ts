export type PatchPlan = {
	version: '1.0';
	summary: string;
	edits: PatchEdit[];
};

export type PatchEdit = CreateFileOp | EditFileOp;

export type CreateFileOp = {
	op: 'createFile';
	path: string;
	content: string;
	overwrite?: boolean;
};

export type EditFileOp = {
	op: 'editFile';
	path: string;
	edits: TextEdit[];
};

export type TextEdit = {
	range: Range;
	text: string;
};

export type Range = {
	start: Position;
	end: Position;
};

export type Position = {
	line: number;
	character: number;
};

export type PatchPlanValidation = {
	ok: boolean;
	errors?: string[];
};