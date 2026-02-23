
export type AccessLevel = 'view' | 'comment' | 'edit';

export function getAccessLevel(): AccessLevel {
    return (document.body.dataset.access as AccessLevel) || 'edit';
}

export function canEdit(): boolean {
    return getAccessLevel() === 'edit';
}

export function canComment(): boolean {
    const level = getAccessLevel();
    return level === 'comment' || level === 'edit';
}
