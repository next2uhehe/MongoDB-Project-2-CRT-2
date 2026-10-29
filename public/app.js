const state = {
  students: [], allStudents: [], courses: [], branches: [], semesters: [],
  overview: null, toastTimer: null
};
const $ = selector => document.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Request failed (${response.status}).`);
  return data;
}
function showToast(message, isError = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('show'), 3600);
}
function setFormMessage(id, message, type = 'success') {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = message;
  element.className = `form-message ${type}`;
}
function queryString(values) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => { if (value !== '' && value !== null && value !== undefined) params.set(key, value); });
  const result = params.toString();
  return result ? `?${result}` : '';
}
function fillBranchSelect(selector, includeAll = false, preferredValue = '') {
  const element = $(selector);
  if (!element) return;
  const current = element.value;
  const options = includeAll ? '<option value="">All branches</option>' : '<option value="">Select branch / department</option>';
  element.innerHTML = options + state.branches.map(branch => `<option value="${escapeHtml(branch.name)}">${escapeHtml(branch.name)}</option>`).join('');
  const desired = preferredValue || current;
  if (state.branches.some(branch => branch.name === desired)) element.value = desired;
  else if (!includeAll && state.branches.length) element.value = state.branches[0].name;
  else element.value = '';
}
function fillSemesterSelect(selector, includeAll = false, preferredValue = '') {
  const element = $(selector);
  if (!element) return;
  const current = element.value;
  const options = includeAll ? '<option value="">All semesters</option>' : '<option value="">Select semester</option>';
  element.innerHTML = options + state.semesters.map(semester => `<option value="${semester}">${semester}${semester === 1 ? 'st' : semester === 2 ? 'nd' : semester === 3 ? 'rd' : 'th'} Semester</option>`).join('');
  const desired = preferredValue || current;
  if (state.semesters.map(String).includes(String(desired))) element.value = String(desired);
  else if (!includeAll) element.value = '5';
  else element.value = '';
}
function configureSelects() {
  fillBranchSelect('#studentDepartment', false, 'AI & Data Science');
  fillBranchSelect('#courseDepartment', false, 'AI & Data Science');
  fillBranchSelect('#studentsDepartmentFilter', true);
  fillBranchSelect('#coursesDepartmentFilter', true);
  fillBranchSelect('#performanceDepartmentFilter', true);
  fillSemesterSelect('#studentSemester', false, '5');
  fillSemesterSelect('#courseSemester', false, '5');
  fillSemesterSelect('#studentsSemesterFilter', true);
  fillSemesterSelect('#coursesSemesterFilter', true);
  fillSemesterSelect('#performanceSemesterFilter', true);
  updateRegistrationPreview();
  updateCourseCodePreview();
}

function switchView(view) {
  document.querySelectorAll('.view-section').forEach(section => section.classList.toggle('active', section.id === `view-${view}`));
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  const titles = { overview: 'Overview', students: 'Students', courses: 'Courses', performance: 'Performance analytics' };
  $('#breadcrumbCurrent').textContent = titles[view] || 'Overview';
  $('#sidebar').classList.remove('open');
  if (view === 'overview') loadOverview();
  if (view === 'students') loadStudents();
  if (view === 'courses') loadCourses();
  if (view === 'performance') loadPerformance();
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
document.querySelectorAll('[data-open-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.openView)));
$('#menuToggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
$('#refreshAnalytics').addEventListener('click', loadPerformance);

function scoreMarkup(value) {
  const score = Math.max(0, Math.min(100, Number(value) || 0));
  const tone = score >= 80 ? 'good' : score >= 60 ? 'mid' : 'low';
  return `<div class="score-cell"><span class="score-number">${score.toFixed(1).replace(/\.0$/, '')}</span><span class="score-track"><span class="score-fill ${tone}" style="width:${score}%"></span></span></div>`;
}
function semesterBadge(semester) { return `<span class="semester-badge">${semester}${semester === 1 ? 'st' : semester === 2 ? 'nd' : semester === 3 ? 'rd' : 'th'} sem</span>`; }
function coursePerformanceTable(rows) {
  if (!rows.length) return '<div class="table-empty">No marks recorded for these filters yet. Add marks from the Students page.</div>';
  return `<table class="data-table"><thead><tr><th>COURSE</th><th>SEMESTER</th><th>STUDENTS</th><th>AVERAGE MARKS</th><th>RANGE</th></tr></thead><tbody>${rows.map(row => `
    <tr><td><div class="primary-cell"><strong>${escapeHtml(row.courseName)}</strong><span class="sub-cell"><span class="course-code">${escapeHtml(row.courseCode)}</span> · ${escapeHtml(row.department)}</span></div></td>
    <td>${semesterBadge(Number(row.semester))}</td><td>${row.totalStudents}</td><td>${scoreMarkup(row.averageMarks)}</td><td>${row.lowestMarks}–${row.highestMarks}</td></tr>`).join('')}</tbody></table>`;
}
function studentsTable(students) {
  if (!students.length) return '<div class="table-empty">No students match these filters. Try a different branch, semester, or search.</div>';
  return `<table class="data-table"><thead><tr><th>STUDENT</th><th>REGISTRATION NUMBER</th><th>BRANCH</th><th>SEMESTER</th><th>MARKS RECORDED</th><th>SEMESTER AVERAGE</th></tr></thead><tbody>${students.map(student => {
    const marks = Array.isArray(student.marks) ? student.marks : [];
    const semesterMarks = marks.filter(mark => state.courses.some(course =>
      course.courseCode === mark.courseCode && course.department === student.department && Number(course.semester) === Number(student.semester)
    ));
    const avg = semesterMarks.length ? semesterMarks.reduce((sum, mark) => sum + Number(mark.marks), 0) / semesterMarks.length : null;
    const branch = state.branches.find(item => item.name === student.department);
    return `<tr><td><div class="student-name-cell"><span class="student-avatar">${escapeHtml(student.name.split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase())}</span><div class="primary-cell"><strong>${escapeHtml(student.name)}</strong><span class="sub-cell">${escapeHtml(student.email)}</span></div></div></td>
      <td><span class="course-code registration-code">${escapeHtml(student.studentId)}</span></td><td><div class="primary-cell"><strong>${escapeHtml(branch ? branch.code : '')}</strong><span class="sub-cell">${escapeHtml(student.department)}</span></div></td><td>${semesterBadge(Number(student.semester))}</td><td>${semesterMarks.length}</td><td>${avg === null ? '<span class="sub-cell">Not graded</span>' : scoreMarkup(Math.round(avg * 100) / 100)}</td></tr>`;
  }).join('')}</tbody></table>`;
}
function coursesTable(courses) {
  if (!courses.length) return '<div class="table-empty">No courses match these filters.</div>';
  return `<table class="data-table"><thead><tr><th>COURSE CODE</th><th>COURSE NAME</th><th>BRANCH / DEPARTMENT</th><th>SEMESTER</th><th>CREDITS</th><th>TYPE</th></tr></thead><tbody>${courses.map(course => `<tr><td><span class="course-code">${escapeHtml(course.courseCode)}</span></td><td><strong>${escapeHtml(course.courseName)}</strong></td><td>${escapeHtml(course.department)}</td><td>${semesterBadge(Number(course.semester))}</td><td>${course.credits}</td><td><span class="type-badge ${course.isLegacyRecord ? 'legacy' : course.isCoreCurriculum ? 'core' : 'extra'}">${course.isLegacyRecord ? 'Legacy record' : course.isCoreCurriculum ? 'Curriculum' : 'Added'}</span></td></tr>`).join('')}</tbody></table>`;
}

async function loadOverview() {
  try {
    const overview = await api('/api/overview');
    state.overview = overview;
    $('#statStudents').textContent = overview.studentCount;
    $('#statCourses').textContent = overview.courseCount;
    $('#statAverage').textContent = `${Number(overview.averageMarks).toFixed(1)}%`;
    $('#statRecorded').textContent = overview.recordedMarks;
    const topCourses = [...overview.performance].sort((a, b) => b.averageMarks - a.averageMarks).slice(0, 5);
    $('#overviewPerformance').innerHTML = coursePerformanceTable(topCourses);
    $('#overviewStudents').innerHTML = studentsTable(state.allStudents.slice(0, 5));
    renderInsights(overview.performance);
  } catch (error) {
    $('#overviewPerformance').innerHTML = `<div class="table-empty">${escapeHtml(error.message)}</div>`;
    showToast(error.message, true);
  }
}
function renderInsights(rows) {
  const container = $('#insightContent');
  if (!rows.length) {
    container.innerHTML = '<div class="table-empty">Record marks to see course insights.</div>';
    return;
  }
  const highest = [...rows].sort((a, b) => b.averageMarks - a.averageMarks)[0];
  const largest = [...rows].sort((a, b) => b.totalStudents - a.totalStudents)[0];
  const lowest = [...rows].sort((a, b) => a.averageMarks - b.averageMarks)[0];
  container.innerHTML = `
    <div class="insight-line"><span class="insight-symbol">↗</span><div><strong>Highest course average</strong><p>${escapeHtml(highest.courseName)} · ${highest.averageMarks}% average</p><small>${escapeHtml(highest.department)} · Semester ${highest.semester}</small></div></div>
    <div class="insight-line"><span class="insight-symbol">♙</span><div><strong>Most students assessed</strong><p>${escapeHtml(largest.courseName)} · ${largest.totalStudents} students</p><small>${escapeHtml(largest.department)} · Semester ${largest.semester}</small></div></div>
    <div class="insight-line"><span class="insight-symbol">◎</span><div><strong>Lowest course average</strong><p>${escapeHtml(lowest.courseName)} · ${lowest.averageMarks}% average</p><small>${escapeHtml(lowest.department)} · Semester ${lowest.semester}</small></div></div>`;
}

function applyStudentFilters() {
  const search = $('#studentSearch').value.trim().toLowerCase();
  const department = $('#studentsDepartmentFilter').value;
  const semester = $('#studentsSemesterFilter').value;
  state.students = state.allStudents.filter(student => {
    const matchesSearch = !search || [student.studentId, student.name, student.email].some(value => String(value || '').toLowerCase().includes(search));
    return matchesSearch && (!department || student.department === department) && (!semester || String(student.semester) === semester);
  });
  $('#studentsTable').innerHTML = studentsTable(state.students);
  const parts = [`${state.students.length} student${state.students.length === 1 ? '' : 's'}`];
  const resultCounter = $('#studentResultCount');
  if (resultCounter) resultCounter.textContent = parts.join('');
}
async function loadStudents() {
  try {
    state.allStudents = await api('/api/students');
    applyStudentFilters();
    populateMarkSelects();
    $('#overviewStudents').innerHTML = studentsTable(state.allStudents.slice(0, 5));
  } catch (error) {
    $('#studentsTable').innerHTML = `<div class="table-empty">${escapeHtml(error.message)}</div>`;
    showToast(error.message, true);
  }
}
function applyCourseFilters() {
  const department = $('#coursesDepartmentFilter').value;
  const semester = $('#coursesSemesterFilter').value;
  const courses = state.courses.filter(course => (!department || course.department === department) && (!semester || String(course.semester) === semester));
  $('#coursesTable').innerHTML = coursesTable(courses);
  $('#courseCount').textContent = `${courses.length} course${courses.length === 1 ? '' : 's'}`;
}
async function loadCourses() {
  try {
    state.courses = await api('/api/courses');
    applyCourseFilters();
    populateMarkSelects();
    updateCourseCodePreview();
    applyStudentFilters();
  } catch (error) { $('#coursesTable').innerHTML = `<div class="table-empty">${escapeHtml(error.message)}</div>`; showToast(error.message, true); }
}
async function loadPerformance() {
  $('#analyticsTable').innerHTML = '<div class="loading-state">Running MongoDB aggregation…</div>';
  try {
    const query = queryString({ department: $('#performanceDepartmentFilter').value, semester: $('#performanceSemesterFilter').value });
    const rows = await api(`/api/performance${query}`);
    $('#analyticsTable').innerHTML = rows.length
      ? `<div class="results-summary">Showing ${rows.length} course${rows.length === 1 ? '' : 's'} · averages are scoped to each course's own branch and semester.</div>${coursePerformanceTable(rows)}`
      : '<div class="table-empty">No marks found for these filters. Select a different branch or semester, or record marks first.</div>';
  } catch (error) { $('#analyticsTable').innerHTML = `<div class="table-empty">${escapeHtml(error.message)}</div>`; showToast(error.message, true); }
}

function populateMarkSelects() {
  const studentSelect = $('#marksStudent');
  const courseSelect = $('#marksCourse');
  if (!studentSelect || !courseSelect) return;
  const selectedStudent = studentSelect.value;
  studentSelect.innerHTML = '<option value="">Select student</option>' + state.allStudents.map(student => `<option value="${escapeHtml(student.studentId)}">${escapeHtml(student.studentId)} · ${escapeHtml(student.name)} · Sem ${student.semester}</option>`).join('');
  if (state.allStudents.some(student => student.studentId === selectedStudent)) studentSelect.value = selectedStudent;
  populateMarkCourseOptions();
}
function populateMarkCourseOptions() {
  const studentId = $('#marksStudent').value;
  const previousCourse = $('#marksCourse').value;
  const student = state.allStudents.find(item => item.studentId === studentId);
  const courseChoices = student
    ? state.courses.filter(course => course.department === student.department && Number(course.semester) === Number(student.semester))
    : state.courses;
  $('#marksCourse').innerHTML = '<option value="">Select course</option>' + courseChoices.map(course => `<option value="${escapeHtml(course.courseCode)}">${escapeHtml(course.courseCode)} · ${escapeHtml(course.courseName)}</option>`).join('');
  if (courseChoices.some(course => course.courseCode === previousCourse)) $('#marksCourse').value = previousCourse;
}
function updateRegistrationPreview() {
  const department = $('#studentDepartment').value;
  const semester = $('#studentSemester').value;
  const branch = state.branches.find(item => item.name === department);
  $('#registrationPreview').textContent = branch && semester ? `${branch.code}${semester}-${String(new Date().getFullYear()).slice(-2)}-XXXXXX` : 'Assigned when saved';
}
function nextCourseCode(department, semester) {
  const branch = state.branches.find(item => item.name === department);
  if (!branch || !semester) return 'Auto-generated';
  const prefix = `${branch.code}${semester}`;
  const used = new Set(state.courses.filter(course => course.department === department && Number(course.semester) === Number(semester)).map(course => course.courseCode));
  for (let number = 1; number <= 99; number += 1) {
    const code = `${prefix}${String(number).padStart(2, '0')}`;
    if (!used.has(code)) return code;
  }
  return `${prefix}XX`;
}
function updateCourseCodePreview() {
  $('#courseCodePreview').textContent = nextCourseCode($('#courseDepartment').value, $('#courseSemester').value);
}

$('#studentDepartment').addEventListener('change', updateRegistrationPreview);
$('#studentSemester').addEventListener('change', updateRegistrationPreview);
$('#courseDepartment').addEventListener('change', updateCourseCodePreview);
$('#courseSemester').addEventListener('change', updateCourseCodePreview);
$('#marksStudent').addEventListener('change', populateMarkCourseOptions);
$('#studentSearch').addEventListener('input', applyStudentFilters);
$('#studentsDepartmentFilter').addEventListener('change', applyStudentFilters);
$('#studentsSemesterFilter').addEventListener('change', applyStudentFilters);
$('#coursesDepartmentFilter').addEventListener('change', applyCourseFilters);
$('#coursesSemesterFilter').addEventListener('change', applyCourseFilters);
$('#resetCourseFilters').addEventListener('click', () => { $('#coursesDepartmentFilter').value = ''; $('#coursesSemesterFilter').value = ''; applyCourseFilters(); });
$('#performanceDepartmentFilter').addEventListener('change', loadPerformance);
$('#performanceSemesterFilter').addEventListener('change', loadPerformance);
$('#clearPerformanceFilters').addEventListener('click', () => { $('#performanceDepartmentFilter').value = ''; $('#performanceSemesterFilter').value = ''; loadPerformance(); });

$('#studentForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  values.semester = Number(values.semester);
  try {
    const result = await api('/api/students', { method: 'POST', body: JSON.stringify(values) });
    form.reset();
    form.elements.department.value = 'AI & Data Science';
    form.elements.semester.value = '5';
    updateRegistrationPreview();
    setFormMessage('studentFormMessage', result.message);
    showToast(result.message);
    await Promise.all([loadStudents(), loadOverview()]);
  } catch (error) { setFormMessage('studentFormMessage', error.message, 'error'); }
});

$('#courseForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  values.semester = Number(values.semester);
  values.credits = Number(values.credits);
  try {
    const result = await api('/api/courses', { method: 'POST', body: JSON.stringify(values) });
    form.reset();
    form.elements.department.value = 'AI & Data Science';
    form.elements.semester.value = '5';
    form.elements.credits.value = '3';
    updateCourseCodePreview();
    setFormMessage('courseFormMessage', result.message);
    showToast(result.message);
    await Promise.all([loadCourses(), loadOverview()]);
  } catch (error) { setFormMessage('courseFormMessage', error.message, 'error'); }
});

$('#marksForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  values.marks = Number(values.marks);
  try {
    const result = await api(`/api/students/${encodeURIComponent(values.studentId)}/marks`, { method: 'PATCH', body: JSON.stringify({ courseCode: values.courseCode, marks: values.marks }) });
    setFormMessage('marksFormMessage', result.message);
    showToast(result.message);
    form.elements.marks.value = '';
    await Promise.all([loadStudents(), loadOverview()]);
    if ($('#view-performance').classList.contains('active')) await loadPerformance();
  } catch (error) { setFormMessage('marksFormMessage', error.message, 'error'); }
});

(async function init() {
  try {
    await api('/api/health');
    const config = await api('/api/config');
    state.branches = config.branches;
    state.semesters = config.semesters;
    configureSelects();
    await Promise.all([loadStudents(), loadCourses()]);
    await loadOverview();
  } catch (error) {
    showToast(`Cannot reach the server: ${error.message}`, true);
  }
})();
