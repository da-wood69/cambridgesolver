// ============================================
// Subject Catalog & Management
// ============================================

// Each subject has a `slug` that matches the folder name on pastpapers.co
const SUBJECT_CATALOG = [
    { name: 'Accounting', code: '9706', slug: 'Accounting-9706' },
    { name: 'Biology', code: '9700', slug: 'Biology-9700' },
    { name: 'Business', code: '9609', slug: 'Business-9609' },
    { name: 'Chemistry', code: '9701', slug: 'Chemistry-9701' },
    { name: 'Computer Science', code: '9618', slug: 'Computer Science (for first examination in 2021) (9618)' },
    { name: 'Economics', code: '9708', slug: 'Economics-9708' },
    { name: 'English Language', code: '9093', slug: 'English-9093' },
    { name: 'English Literature', code: '9695', slug: 'English-9695' },
    { name: 'Further Mathematics', code: '9231', slug: 'Mathematics-Further-9231' },
    { name: 'Geography', code: '9696', slug: 'Geography-9696' },
    { name: 'History', code: '9489', slug: 'History-9489' },
    { name: 'Information Technology', code: '9626', slug: 'Information-Technology-9626' },
    { name: 'Islamic Studies', code: '9488', slug: 'Islamic studies-9488' },
    { name: 'Law', code: '9084', slug: 'Law-9084' },
    { name: 'Marine Science', code: '9693', slug: 'Marine-Science-9693' },
    { name: 'Mathematics', code: '9709', slug: 'Mathematics-9709' },
    { name: 'Media Studies', code: '9607', slug: 'Media-Studies-9607' },
    { name: 'Physics', code: '9702', slug: 'Physics-9702' },
    { name: 'Psychology', code: '9990', slug: 'Psychology-9990' },
    { name: 'Sociology', code: '9699', slug: 'Sociology-9699' },
    { name: 'Thinking Skills', code: '9694', slug: 'Thinking-Skills-9694' },
    { name: 'Travel & Tourism', code: '9395', slug: 'Travel-&-Tourism-9395' },
    { name: 'Urdu', code: '9686', slug: 'Urdu-9686' },
    { name: 'Art & Design', code: '9479', slug: 'Art-and-Design-9479' },
    { name: 'Design & Technology', code: '9705', slug: 'Design-and-Technology-9705' },
    { name: 'Music', code: '9483', slug: 'Music-9483' },
    { name: 'Physical Education', code: '9396', slug: 'Physical-Education-9396' },
    { name: 'Global Perspectives & Research', code: '9239', slug: 'Global-Perspectives-and-Research-9239' },
    { name: 'Classical Studies', code: '9274', slug: 'Classical-Studies-9274' },
    { name: 'Drama', code: '9482', slug: 'Drama (9482)' },
];

// Sort alphabetically
SUBJECT_CATALOG.sort((a, b) => a.name.localeCompare(b.name));

const STORAGE_KEY = 'cie-added-subjects';

function getAddedSubjects() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return parsed.map(s => {
            const catalogItem = SUBJECT_CATALOG.find(cat => cat.code === s.code);
            return catalogItem ? { ...s, ...catalogItem } : s;
        });
    } catch {
        return [];
    }
}

function saveAddedSubjects(subjects) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(subjects));
}

function addSubject(subject) {
    const added = getAddedSubjects();
    if (!added.find(s => s.code === subject.code)) {
        added.push(subject);
        saveAddedSubjects(added);
    }
    return added;
}

function removeSubject(code) {
    let added = getAddedSubjects();
    added = added.filter(s => s.code !== code);
    saveAddedSubjects(added);
    return added;
}

function isSubjectAdded(code) {
    return getAddedSubjects().some(s => s.code === code);
}
