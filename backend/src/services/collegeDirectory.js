// ======================================================
// CAMPUSBUS COLLEGE DIRECTORY INTEGRATION
// ======================================================
//
// DEVELOPMENT:
// Uses mock college records so CampusBus can be developed
// without access to the real college database.
//
// PRODUCTION:
// This service can later call the college ERP/API without
// changing the CampusBus Users page or account-creation flow.
// ======================================================


const MOCK_COLLEGE_RECORDS = [
  {
    institutionId: '1SJ24CS001',
    role: 'STUDENT',
    name: 'Demo Student One',
    email: 'student.one@college.edu',
    phone: '9876500001',
    course: 'BE CSE',
    semester: '5',
    department: 'Computer Science and Engineering'
  },

  {
    institutionId: '1SJ24CS002',
    role: 'STUDENT',
    name: 'Demo Student Two',
    email: 'student.two@college.edu',
    phone: '9876500002',
    course: 'BE CSE',
    semester: '5',
    department: 'Computer Science and Engineering'
  },

  {
    institutionId: '1SJ24EC001',
    role: 'STUDENT',
    name: 'Demo ECE Student',
    email: 'student.ece@college.edu',
    phone: '9876500003',
    course: 'BE ECE',
    semester: '5',
    department: 'Electronics and Communication Engineering'
  },

  {
    institutionId: 'STF-CSE-001',
    role: 'STAFF',
    name: 'Demo CSE Staff',
    email: 'staff.cse@college.edu',
    phone: '9876500010',
    department: 'Computer Science and Engineering'
  },

  {
    institutionId: 'STF-ISE-001',
    role: 'STAFF',
    name: 'Demo ISE Staff',
    email: 'staff.ise@college.edu',
    phone: '9876500011',
    department: 'Information Science and Engineering'
  }
];


// ======================================================
// NORMALIZE IDENTIFIER
// ======================================================

function normalizeIdentifier(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}


// ======================================================
// NORMALIZE ROLE
// ======================================================

function normalizeRole(value) {
  const role = String(value || '')
    .trim()
    .toUpperCase();

  if (
    role === 'STUDENT' ||
    role === 'STAFF'
  ) {
    return role;
  }

  return null;
}


// ======================================================
// NORMALIZE COLLEGE RECORD
// ======================================================

function normalizeCollegeRecord(record) {
  if (!record) {
    return null;
  }

  const role =
    normalizeRole(record.role);

  const institutionId =
    normalizeIdentifier(
      record.institutionId ||
      record.usn ||
      record.studentNumber ||
      record.employeeId
    );

  const name =
    String(
      record.name ||
      record.fullName ||
      ''
    ).trim();

  const email =
    String(
      record.email ||
      ''
    )
      .trim()
      .toLowerCase();

  const phone =
    String(
      record.phone ||
      record.mobile ||
      ''
    ).trim();

  if (
    !institutionId ||
    !name ||
    !role
  ) {
    return null;
  }

  return {
    institutionId,
    role,
    name,

    email:
      email || null,

    phone:
      phone || null,

    course:
      record.course
        ? String(
            record.course
          ).trim()
        : null,

    semester:
      record.semester !==
      undefined &&
      record.semester !==
      null
        ? String(
            record.semester
          ).trim()
        : null,

    department:
      record.department
        ? String(
            record.department
          ).trim()
        : null
  };
}


// ======================================================
// MOCK DIRECTORY SEARCH
// ======================================================

async function findMockRecord(
  identifier
) {
  const clean =
    normalizeIdentifier(
      identifier
    );

  const record =
    MOCK_COLLEGE_RECORDS.find(
      item =>
        normalizeIdentifier(
          item.institutionId
        ) === clean
    );

  return normalizeCollegeRecord(
    record
  );
}


// ======================================================
// REAL COLLEGE API SEARCH
// ======================================================
//
// Expected environment variables:
//
// COLLEGE_DIRECTORY_MODE=api
// COLLEGE_DIRECTORY_API_URL=https://college-api.example.edu
// COLLEGE_DIRECTORY_API_KEY=...
//
// Expected endpoint example:
//
// GET /students-or-staff/{identifier}
//
// The response can later be adapted here if your college
// ERP uses different field names.
// ======================================================

async function findApiRecord(
  identifier
) {
  const baseUrl =
    String(
      process.env
        .COLLEGE_DIRECTORY_API_URL ||
      ''
    )
      .trim()
      .replace(/\/$/, '');

  if (!baseUrl) {
    throw new Error(
      'COLLEGE_DIRECTORY_API_URL is not configured.'
    );
  }

  const clean =
    normalizeIdentifier(
      identifier
    );

  const headers = {
    Accept:
      'application/json'
  };

  const apiKey =
    String(
      process.env
        .COLLEGE_DIRECTORY_API_KEY ||
      ''
    ).trim();

  if (apiKey) {
    headers.Authorization =
      `Bearer ${apiKey}`;
  }

  const response =
    await fetch(
      `${baseUrl}/students-or-staff/${encodeURIComponent(
        clean
      )}`,
      {
        method: 'GET',
        headers,
        signal:
          AbortSignal.timeout(
            10000
          )
      }
    );

  if (
    response.status === 404
  ) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `College directory request failed with status ${response.status}.`
    );
  }

  const data =
    await response.json();

  return normalizeCollegeRecord(
    data
  );
}


// ======================================================
// PUBLIC SEARCH FUNCTION
// ======================================================

export async function findCollegeRecord(
  identifier
) {
  const clean =
    normalizeIdentifier(
      identifier
    );

  if (!clean) {
    return null;
  }

  const mode =
    String(
      process.env
        .COLLEGE_DIRECTORY_MODE ||
      'mock'
    )
      .trim()
      .toLowerCase();

  if (mode === 'api') {
    return findApiRecord(
      clean
    );
  }

  return findMockRecord(
    clean
  );
}


// ======================================================
// DIRECTORY STATUS
// ======================================================

export function collegeDirectoryStatus() {
  const mode =
    String(
      process.env
        .COLLEGE_DIRECTORY_MODE ||
      'mock'
    )
      .trim()
      .toLowerCase();

  return {
    mode,

    configured:
      mode === 'mock'
        ? true
        : Boolean(
            process.env
              .COLLEGE_DIRECTORY_API_URL
          )
  };
}