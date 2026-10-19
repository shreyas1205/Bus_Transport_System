import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const initial = {
  name: '',
  email: '',
  password: 'Pass@123',
  role: 'DRIVER',
  phone: '',
  institutionId: '',
  licenseNumber: '',
  licenseExpiry: '',
  course: '',
  semester: '',
  department: '',
  studentId: '',
  guardianPhone: ''
};

const roleAliases = {
  student: 'STUDENT',
  students: 'STUDENT',
  stud: 'STUDENT',
  s: 'STUDENT',

  driver: 'DRIVER',
  drivers: 'DRIVER',
  drv: 'DRIVER',
  d: 'DRIVER',

  parent: 'PARENT',
  parents: 'PARENT',
  mom: 'PARENT',
  dad: 'PARENT'
};

function parseRoster(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const parts = line
        .split(/\s*[|;,]\s*/)
        .map(x => x.trim())
        .filter(Boolean);

      const roleIndex = parts.findIndex(
        x =>
          !!roleAliases[x.toLowerCase()] ||
          ['DRIVER', 'STUDENT', 'PARENT'].includes(
            x.toUpperCase()
          )
      );

      const role =
        roleIndex >= 0
          ? roleAliases[
              parts[roleIndex].toLowerCase()
            ] ||
            parts[roleIndex].toUpperCase()
          : '';

      const name =
        parts[0] || '';

      const institutionId =
        parts[
          roleIndex >= 0
            ? roleIndex + 1
            : 1
        ] || '';

      const contact = parts[roleIndex >= 0 ? roleIndex + 2 : 2] || '';
      return {
        name,
        role,
        institutionId,
        ...(role === 'STUDENT' ? { guardianPhone: contact } : {}),
        ...(role === 'PARENT' ? { phone: contact } : {})
      };
    });
}

function getStatusStyle(status) {
  if (status === 'VERIFIED') {
    return {
      background: '#dcfce7',
      color: '#166534'
    };
  }

  if (status === 'REJECTED') {
    return {
      background: '#fee2e2',
      color: '#991b1b'
    };
  }

  return {
    background: '#fef3c7',
    color: '#92400e'
  };
}

export default function Users() {
  const [users, setUsers] =
    useState([]);

  const [guardianContacts, setGuardianContacts] = useState({});

  const [role, setRole] =
    useState('');

  const [
    draftPhones,
    setDraftPhones
  ] = useState({});

  const [
    savingId,
    setSavingId
  ] = useState('');

  const [
    notice,
    setNotice
  ] = useState('');

  const [
    error,
    setError
  ] = useState('');

  const [
    showCreate,
    setShowCreate
  ] = useState(false);

  const [
    form,
    setForm
  ] = useState({
    ...initial
  });

  const [
    busy,
    setBusy
  ] = useState(false);

  const [
    created,
    setCreated
  ] = useState(null);

  const [
    showAi,
    setShowAi
  ] = useState(false);

  const [
    roster,
    setRoster
  ] = useState(
    'Rahul Kumar | Student | 23CSE001\n' +
      'Ramesh Kumar | Driver | DRV001\n' +
      'Sita Sharma | Parent'
  );

  const [
    aiBusy,
    setAiBusy
  ] = useState(false);

  const [
    aiResults,
    setAiResults
  ] = useState([]);

  const [aiRows, setAiRows] = useState([]);
  const [aiMode, setAiMode] = useState('form');

  const [
    reviewingId,
    setReviewingId
  ] = useState('');

  const [
    reviewingAction,
    setReviewingAction
  ] = useState('');

  const [
    reviewNotes,
    setReviewNotes
  ] = useState({});

  const [
    showCollege,
    setShowCollege
  ] = useState(false);

  const [
    collegeIdentifier,
    setCollegeIdentifier
  ] = useState('');

  const [
    collegeRecord,
    setCollegeRecord
  ] = useState(null);

  const [
    collegeBusy,
    setCollegeBusy
  ] = useState(false);

  const [
    collegeImportBusy,
    setCollegeImportBusy
  ] = useState(false);

  const [search, setSearch] = useState('');

  const [selectedDriver, setSelectedDriver] = useState(null);

  const parsedRoster =
    useMemo(
      () =>
        parseRoster(
          roster
        ),
      [roster]
    );

  useEffect(() => {
    if (aiMode === 'paste') setAiRows(parsedRoster);
  }, [roster, aiMode, parsedRoster]);

  function addAiPerson() {
    setAiRows(current => [...current, { name: '', role: 'STUDENT', institutionId: '' }]);
  }

  function updateAiPerson(index, key, value) {
    setAiRows(current => current.map((item, i) => i === index ? { ...item, [key]: value } : item));
  }

  function removeAiPerson(index) {
    setAiRows(current => current.filter((_, i) => i !== index));
  }

  function handleRosterCsv(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = event => {
      const lines = String(event.target?.result || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      const rows = lines.map((line, index) => {
        const parts = line.split(',').map(x => x.trim());
        if (index === 0 && /name/i.test(parts[0] || '') && /role/i.test(parts[1] || '')) return null;
        return {
          name: parts[0] || '',
          role: roleAliases[(parts[1] || '').toLowerCase()] || (parts[1] || '').toUpperCase(),
          institutionId: parts[2] || '',
          ...(String(parts[1]).toUpperCase() === 'STUDENT' ? { guardianPhone: parts[3] || '' } : {}),
          ...(String(parts[1]).toUpperCase() === 'PARENT' ? { phone: parts[3] || '' } : {})
        };
      }).filter(Boolean);
      setAiRows(rows);
      setAiMode('form');
      setNotice(rows.length ? `${rows.length} roster row(s) imported. Review before creating accounts.` : '');
      setError(rows.length ? '' : 'No usable roster rows found in the CSV.');
    };
    reader.readAsText(file);
  }

  // ==========================================
  // LOAD USERS
  // ==========================================

  async function load() {
    try {
      setError('');

      const response =
        await api.get(
          '/users',
          {
            params:
              role
                ? {
                    role
                  }
                : undefined
          }
        );

      const data =
        Array.isArray(
          response.data
        )
          ? response.data
          : [];

      setUsers(data);

      const phones = {};

      data.forEach(
        user => {
          if (
            user.role ===
            'DRIVER'
          ) {
            phones[
              user.id
            ] =
              user.phone ||
              '';
          }
        }
      );

      setDraftPhones(
        phones
      );
      const contacts = {};
      data.forEach(user => {
        if (user.role === 'STUDENT') contacts[user.id] = user.studentProfile?.guardianPhone || '';
        if (user.role === 'PARENT') contacts[user.id] = user.phone || '';
      });
      setGuardianContacts(contacts);

    } catch (e) {
      console.error(
        'LOAD USERS ERROR:',
        e
      );

      setError(
        e.response?.data
          ?.message ||
          'Could not load users'
      );
    }
  }

  useEffect(
    () => {
      load();
    },
    [role]
  );

  // ==========================================
  // FORM
  // ==========================================

  function change(
    key,
    value
  ) {
    setForm(
      current => ({
        ...current,
        [key]: value
      })
    );

    setCreated(null);
  }

  function resetForm() {
    setForm({
      ...initial
    });

    setCreated(null);
  }

  // ==========================================
  // CREATE ACCOUNT
  // ==========================================

  async function create(
    event
  ) {
    event.preventDefault();

    try {
      setBusy(true);

      setNotice('');

      setError('');

      const response =
        await api.post(
          '/users',
          form
        );

      setCreated({
        email:
          response.data.email,

        password:
          form.password,

        role:
          response.data.role,

        name:
          response.data.name
      });

      setNotice(
        `${response.data.role} account created successfully.`
      );

      setForm({
        ...initial
      });

      await load();
    } catch (e) {
      setError(
        e.response?.data
          ?.message ||
          'Could not create account'
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveGuardianContact(user) {
    try {
      setSavingId(user.id);
      setError('');
      setNotice('');
      const response = await api.patch(`/users/${user.id}/guardian-contact`, {
        phone: guardianContacts[user.id] || ''
      });
      setNotice(response.data.message);
      await load();
    } catch (e) {
      setError(e.response?.data?.message || 'Could not save guardian contact');
    } finally {
      setSavingId('');
    }
  }

  // ==========================================
  // SAVE DRIVER PHONE
  // ==========================================

  async function savePhone(
    id
  ) {
    try {
      setSavingId(id);

      setNotice('');

      setError('');

      const response =
        await api.patch(
          `/users/${id}/phone`,
          {
            phone:
              draftPhones[
                id
              ] || ''
          }
        );

      setNotice(
        'Driver phone updated successfully.'
      );

      await load();

      setDraftPhones(
        current => ({
          ...current,

          [id]:
            response.data
              .phone || ''
        })
      );
    } catch (e) {
      setError(
        e.response?.data
          ?.message ||
          'Could not update driver phone'
      );
    } finally {
      setSavingId('');
    }
  }

  // ==========================================
  // VERIFY / REJECT LICENSE
  // ==========================================

  async function reviewLicense(
    id,
    status
  ) {
    const note =
      reviewNotes[
        id
      ]?.trim() || '';

    if (
      status ===
        'REJECTED' &&
      !note
    ) {
      setNotice('');

      setError(
        'Please enter a rejection reason first.'
      );

      return;
    }

    try {
      setReviewingId(
        id
      );

      setReviewingAction(
        status
      );

      setNotice('');

      setError('');

      const response =
        await api.patch(
          `/users/${id}/license-review`,
          {
            status,
            note
          }
        );

      setNotice(
        response.data
          ?.message ||
          (
            status ===
            'VERIFIED'
              ? 'Driver license verified successfully.'
              : 'Driver license rejected.'
          )
      );

      await load();

      if (
        status ===
        'VERIFIED'
      ) {
        setReviewNotes(
          current => ({
            ...current,

            [id]: ''
          })
        );
      }
    } catch (e) {
      console.error(
        'LICENSE REVIEW ERROR:',
        e
      );

      setError(
        e.response?.data
          ?.message ||
          'Could not review driver license.'
      );
    } finally {
      setReviewingId('');

      setReviewingAction(
        ''
      );
    }
  }

  // ==========================================
  // AI BULK CREATE
  // ==========================================

  async function aiCreate() {
    setAiBusy(true);

    setNotice('');

    setError('');

    setAiResults([]);

    const valid =
      aiRows.filter(
        item =>
          item.name &&
          item.role
      );

    if (
      !valid.length
    ) {
      setError(
        'Add roster lines with a name and Driver, Student or Parent role.'
      );

      setAiBusy(false);

      return;
    }

    const missing =
      aiRows.find(
        item =>
          !item.name ||
          !item.role
      );

    if (missing) {
      setError(
        'Complete the highlighted member details before creating accounts.'
      );

      setAiBusy(false);

      return;
    }

    try {
      const response =
        await api.post(
          '/users/ai-bulk-create',
          {
            records:
              valid
          }
        );

      setAiResults(
        response.data
          .created || []
      );

      setNotice(
        response.data
          .message ||
          'Accounts created automatically.'
      );

      await load();
    } catch (e) {
      setError(
        e.response?.data
          ?.message ||
          'AI account generation failed'
      );
    } finally {
      setAiBusy(false);
    }
  }

  // ==========================================
  // DOWNLOAD CREDENTIALS
  // ==========================================

  function downloadCredentials() {
    if (
      !aiResults.length
    ) {
      return;
    }

    const rows = [
      [
        'Name',
        'Role',
        'Login ID',
        'Temporary Password',
        'Institution ID',
        'Phone'
      ],

      ...aiResults.map(
        item => [
          item.name,
          item.role,
          item.email,
          item.password,
          item.institutionId,
          item.phone || ''
        ]
      )
    ];

    const csv =
      rows
        .map(
          row =>
            row
              .map(
                value =>
                  `"${String(
                    value ??
                      ''
                  ).replaceAll(
                    '"',
                    '""'
                  )}"`
              )
              .join(',')
        )
        .join('\n');

    const blob =
      new Blob(
        [csv],
        {
          type:
            'text/csv;charset=utf-8'
        }
      );

    const url =
      URL.createObjectURL(
        blob
      );

    const anchor =
      document.createElement(
        'a'
      );

    anchor.href =
      url;

    anchor.download =
      'naviguard-generated-credentials.csv';

    anchor.click();

    URL.revokeObjectURL(
      url
    );
  }

  // ==========================================
  // COLLEGE RECORD LOOKUP
  // ==========================================

  async function fetchCollegeRecord() {
    const identifier =
      collegeIdentifier.trim();

    if (
      !identifier
    ) {
      setNotice('');

      setError(
        'Enter a student USN or staff ID.'
      );

      return;
    }

    try {
      setCollegeBusy(
        true
      );

      setNotice('');

      setError('');

      setCollegeRecord(
        null
      );

      const response =
        await api.get(
          `/users/college-record/${encodeURIComponent(
            identifier
          )}`
        );

      setCollegeRecord(
        response.data
      );

      if (
        response.data
          ?.alreadyRegistered
      ) {
        setNotice(
          'College record found. This member already has an account.'
        );
      } else {
        setNotice(
          'College record found successfully.'
        );
      }
    } catch (e) {
      console.error(
        'COLLEGE LOOKUP ERROR:',
        e
      );

      setCollegeRecord(
        null
      );

      setError(
        e.response?.data
          ?.message ||
          'Could not retrieve college record.'
      );
    } finally {
      setCollegeBusy(
        false
      );
    }
  }

  // ==========================================
  // IMPORT COLLEGE RECORD
  // ==========================================

  async function importCollegeRecord() {
    const identifier =
      collegeRecord
        ?.record
        ?.institutionId ||
      collegeIdentifier.trim();

    if (
      !identifier
    ) {
      return;
    }

    try {
      setCollegeImportBusy(
        true
      );

      setNotice('');

      setError('');

      const response =
        await api.post(
          '/users/import-college-record',
          {
            identifier
          }
        );

      setNotice(
        response.data
          ?.message ||
          'NaviGuard account created successfully.'
      );

      setCollegeRecord(
        null
      );

      setCollegeIdentifier(
        ''
      );

      await load();
    } catch (e) {
      console.error(
        'COLLEGE IMPORT ERROR:',
        e
      );

      setError(
        e.response?.data
          ?.message ||
          'Could not create NaviGuard account.'
      );
    } finally {
      setCollegeImportBusy(
        false
      );
    }
  }

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(user =>
      [user.name, user.email, user.institutionId, user.phone, user.role]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(q))
    );
  }, [users, search]);

  // ==========================================
  // UI
  // ==========================================

  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">
            ADMINISTRATION
          </span>

          <h2>
            Users & accounts
          </h2>

          <p>
            Create and manage NaviGuard
            accounts, import students and
            staff from college records,
            and review driver details.
          </p>
        </div>

        <div className="button-row users-command-toolbar">
          <select
            className="select"
            value={role}
            onChange={
              e =>
                setRole(
                  e.target.value
                )
            }
          >
            <option value="">
              All roles
            </option>

            <option>
              ADMIN
            </option>

            <option>
              DRIVER
            </option>

            <option>
              STUDENT
            </option>

            <option>
              STAFF
            </option>

            <option>
              PARENT
            </option>
          </select>

          <button
            type="button"
            className="secondary"
            onClick={() => {
              setShowCollege(value => {
                const next = !value;
                if (next) {
                  setShowAi(false);
                  setShowCreate(false);
                }
                return next;
              });

              setError('');

              setNotice('');
            }}
          >
            {showCollege
              ? 'Close college import'
              : '🏫 College import'}
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() => {
              setShowAi(value => {
                const next = !value;
                if (next) {
                  setShowCollege(false);
                  setShowCreate(false);
                }
                return next;
              });

              setError('');

              setNotice('');
            }}
          >
            ✨ AI credential assistant
          </button>

          <button
            type="button"
            className="primary"
            onClick={() => {
              setShowCreate(value => {
                const next = !value;
                if (next) {
                  setShowCollege(false);
                  setShowAi(false);
                }
                return next;
              });

              setError('');

              setNotice('');
            }}
          >
            {showCreate
              ? 'Close'
              : '＋ Create account'}
          </button>
        </div>
      </div>

      {notice && (
        <div className="success">
          {notice}
        </div>
      )}

      {error && (
        <div className="error">
          {error}
        </div>
      )}

      {/* ======================================
          COLLEGE DIRECTORY IMPORT
      ====================================== */}

      {showCollege && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">
                COLLEGE DIRECTORY
              </span>

              <h3>
                Import student or staff
                account
              </h3>

              <p>
                Enter a student USN or
                staff ID. NaviGuard will
                fetch the college record
                before creating the
                account.
              </p>
            </div>
          </div>

          <div
            className="button-row"
            style={{
              alignItems: 'end',
              marginBottom: 18
            }}
          >
            <label
              style={{
                minWidth: 280,
                flex: 1
              }}
            >
              Student USN / Staff ID

              <input
                value={
                  collegeIdentifier
                }
                onChange={
                  e => {
                    setCollegeIdentifier(
                      e.target.value
                    );

                    setCollegeRecord(
                      null
                    );
                  }
                }
                onKeyDown={
                  e => {
                    if (
                      e.key ===
                      'Enter'
                    ) {
                      e.preventDefault();

                      fetchCollegeRecord();
                    }
                  }
                }
                placeholder="Example: 1SJ24CS001"
              />
            </label>

            <button
              type="button"
              className="primary"
              onClick={
                fetchCollegeRecord
              }
              disabled={
                collegeBusy
              }
            >
              {collegeBusy
                ? 'Fetching…'
                : 'Fetch college record'}
            </button>
          </div>

          {collegeRecord
            ?.record && (
            <div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>
                        Name
                      </th>

                      <th>
                        Role
                      </th>

                      <th>
                        Institution ID
                      </th>

                      <th>
                        Email
                      </th>

                      <th>
                        Phone
                      </th>

                      <th>
                        Course
                      </th>

                      <th>
                        Semester
                      </th>

                      <th>
                        Department
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    <tr>
                      <td>
                        <b>
                          {
                            collegeRecord
                              .record
                              .name
                          }
                        </b>
                      </td>

                      <td>
                        <span className="chip good">
                          {
                            collegeRecord
                              .record
                              .role
                          }
                        </span>
                      </td>

                      <td>
                        {
                          collegeRecord
                            .record
                            .institutionId ||
                          '—'
                        }
                      </td>

                      <td>
                        {
                          collegeRecord
                            .record
                            .email ||
                          '—'
                        }
                      </td>

                      <td>
                        {
                          collegeRecord
                            .record
                            .phone ||
                          '—'
                        }
                      </td>

                      <td>
                        {
                          collegeRecord
                            .record
                            .course ||
                          '—'
                        }
                      </td>

                      <td>
                        {
                          collegeRecord
                            .record
                            .semester ||
                          '—'
                        }
                      </td>

                      <td>
                        {
                          collegeRecord
                            .record
                            .department ||
                          '—'
                        }
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {collegeRecord
                .alreadyRegistered ? (
                <div
                  className="error"
                  style={{
                    marginTop: 14,
                    marginBottom: 0
                  }}
                >
                  This college member
                  already has a NaviGuard
                  account
                  {collegeRecord
                    .existingUser
                    ?.email
                    ? ` (${collegeRecord.existingUser.email})`
                    : ''}
                  .
                </div>
              ) : (
                <div
                  className="button-row"
                  style={{
                    marginTop: 14
                  }}
                >
                  <button
                    type="button"
                    className="primary"
                    onClick={
                      importCollegeRecord
                    }
                    disabled={
                      collegeImportBusy
                    }
                  >
                    {collegeImportBusy
                      ? 'Creating account…'
                      : 'Create NaviGuard account'}
                  </button>

                  <small>
                    The member can use
                    the existing Forgot
                    Password OTP flow to
                    set their own
                    password.
                  </small>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* ======================================
          AI ASSISTANT
      ====================================== */}

      {showAi && (
        <section className="panel onboarding-assistant">
          <div className="onboarding-head">
            <div>
              <span className="eyebrow">ACCOUNT ONBOARDING</span>
              <h3>Add multiple NaviGuard members</h3>
              <p>Add people normally, paste a roster, or import a CSV. Review everything before accounts are created.</p>
            </div>
            <div className="onboarding-ready">
              <strong>{aiRows.filter(x => x.name && x.role).length}</strong>
              <span>members ready</span>
            </div>
          </div>

          <div className="onboarding-methods">
            <button type="button" className={aiMode === 'form' ? 'primary' : 'secondary'} onClick={() => setAiMode('form')}>+ Add people</button>
            <button type="button" className={aiMode === 'paste' ? 'primary' : 'secondary'} onClick={() => setAiMode('paste')}>Paste a list</button>
            <label className="csv-upload-button">Upload CSV<input type="file" accept=".csv,text/csv" onChange={e => handleRosterCsv(e.target.files?.[0])} /></label>
          </div>

          {aiMode === 'paste' ? (
            <div className="paste-roster-box">
              <div><b>Paste your roster</b><small>Simple lines work: Rahul Kumar, Student, 23CSE001</small></div>
              <textarea value={roster} onChange={e => setRoster(e.target.value)}
                placeholder={'Rahul Kumar, Student, 23CSE001\nRamesh Kumar, Driver, DRV001\nSita Sharma, Parent'} />
              <div className="paste-help"><span>Comma, semicolon and | separators are accepted.</span><button type="button" className="primary" onClick={() => setAiMode('form')}>Review members →</button></div>
            </div>
          ) : (
            <div className="member-builder">
              <div className="member-builder-head"><div><b>Review member details</b><small>Edit anything before creating accounts.</small></div><button type="button" className="secondary" onClick={addAiPerson}>+ Add person</button></div>
              {aiRows.length === 0 ? (
                <div className="member-empty"><strong>No people added yet</strong><span>Add a person, paste a list, or upload a CSV.</span><button type="button" className="primary" onClick={addAiPerson}>+ Add first person</button></div>
              ) : (
                <div className="member-edit-list">
                  {aiRows.map((item,index) => {
                    const valid=item.name && ['STUDENT','DRIVER','PARENT'].includes(item.role) && (item.role !== 'STUDENT' || !!item.guardianPhone) && (item.role !== 'PARENT' || !!item.phone);
                    return <div className={`member-edit-row ${valid ? '' : 'needs-attention'}`} key={index}>
                      <div className="member-index">{String(index+1).padStart(2,'0')}</div>
                      <label><span>Name</span><input value={item.name} onChange={e=>updateAiPerson(index,'name',e.target.value)} placeholder="Full name"/></label>
                      <label><span>Role</span><select value={item.role||''} onChange={e=>updateAiPerson(index,'role',e.target.value)}><option value="">Select role</option><option value="STUDENT">Student</option><option value="DRIVER">Driver</option><option value="PARENT">Parent</option></select></label>
                      <label><span>Institution ID <em>optional</em></span><input value={item.institutionId||''} onChange={e=>updateAiPerson(index,'institutionId',e.target.value)} placeholder="Auto-generate if blank"/></label>
                      {item.role === 'STUDENT' && <label><span>Guardian phone</span><input value={item.guardianPhone||''} onChange={e=>updateAiPerson(index,'guardianPhone',e.target.value)} placeholder="Parent's phone" inputMode="tel" /></label>}
                      {item.role === 'PARENT' && <label><span>Parent phone</span><input value={item.phone||''} onChange={e=>updateAiPerson(index,'phone',e.target.value)} placeholder="Guardian's phone" inputMode="tel" /></label>}
                      <div className={`member-ready-state ${valid?'ready':'missing'}`}>{valid?'Ready':'Needs details'}</div>
                      <button type="button" className="member-remove" onClick={()=>removeAiPerson(index)}>×</button>
                    </div>
                  })}
                </div>
              )}
              {aiRows.length>0 && <div className="member-create-bar"><div><strong>{aiRows.filter(x=>x.name&&['STUDENT','DRIVER','PARENT'].includes(x.role)).length} of {aiRows.length} ready</strong><span>Login IDs and temporary passwords are generated automatically.</span></div><button type="button" className="primary create-members-button" onClick={aiCreate} disabled={aiBusy||aiRows.some(x=>!x.name||!['STUDENT','DRIVER','PARENT'].includes(x.role)||(x.role==='STUDENT'&&!x.guardianPhone)||(x.role==='PARENT'&&!x.phone))}>{aiBusy?'Creating accounts…':`Create ${aiRows.length} account${aiRows.length===1?'':'s'}`}</button></div>}
            </div>
          )}

          {aiResults.length>0 && <div className="created-credentials">
            <div className="created-credentials-head"><div><span className="eyebrow">ACCOUNTS CREATED</span><h3>Credentials are ready</h3><p>Share temporary credentials securely with each member.</p></div><button type="button" className="secondary" onClick={downloadCredentials}>Download credentials CSV</button></div>
            <div className="credential-result-grid">{aiResults.map(item=><article key={item.id} className="credential-result-card"><div className="credential-result-top"><span>{(item.name||'?').charAt(0).toUpperCase()}</span><div><b>{item.name}</b><small>{item.role}</small></div></div><dl><div><dt>Login</dt><dd>{item.email}</dd></div><div><dt>Temporary password</dt><dd><code>{item.password}</code></dd></div><div><dt>Institution ID</dt><dd>{item.institutionId||'—'}</dd></div></dl></article>)}</div>
          </div>}
        </section>
      )}

      {/* ======================================
          CREATE ACCOUNT
      ====================================== */}

      {showCreate && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h3>
                Create a new login
              </h3>

              <p>
                Create driver, student,
                parent or staff accounts.
              </p>
            </div>
          </div>

          <form
            className="account-form"
            onSubmit={
              create
            }
          >
            <label>
              Full name

              <input
                value={
                  form.name
                }
                onChange={
                  e =>
                    change(
                      'name',
                      e.target
                        .value
                    )
                }
                placeholder="Rahul Kumar"
                required
              />
            </label>

            <label>
              Role

              <select
                value={
                  form.role
                }
                onChange={
                  e =>
                    change(
                      'role',
                      e.target
                        .value
                    )
                }
              >
                <option>
                  DRIVER
                </option>

                <option>
                  STUDENT
                </option>

                <option>
                  STAFF
                </option>

                <option>
                  PARENT
                </option>
              </select>
            </label>

            <label>
              Email / login ID

              <input
                type="email"
                value={
                  form.email
                }
                onChange={
                  e =>
                    change(
                      'email',
                      e.target
                        .value
                    )
                }
                placeholder="rahul@campusbus.local"
                required
              />
            </label>

            <label>
              Password

              <input
                type="password"
                value={
                  form.password
                }
                onChange={
                  e =>
                    change(
                      'password',
                      e.target
                        .value
                    )
                }
                minLength="6"
                required
              />
            </label>

            <label>
              Phone

              <input
                value={
                  form.phone
                }
                onChange={
                  e =>
                    change(
                      'phone',
                      e.target
                        .value
                    )
                }
                placeholder="9000000010"
                inputMode="tel"
                required={form.role === 'PARENT'}
              />
            </label>

            <label>
              Institution / student ID

              <input
                value={
                  form.institutionId
                }
                onChange={
                  e =>
                    change(
                      'institutionId',
                      e.target
                        .value
                    )
                }
                placeholder="23CSE010"
              />
            </label>

            {form.role ===
              'DRIVER' && (
              <>
                <label>
                  License number

                  <input
                    value={
                      form.licenseNumber
                    }
                    onChange={
                      e =>
                        change(
                          'licenseNumber',
                          e.target
                            .value
                        )
                    }
                    placeholder="KA-DL-12345"
                  />
                </label>

                <label>
                  License expiry

                  <input
                    type="date"
                    value={
                      form.licenseExpiry
                    }
                    onChange={
                      e =>
                        change(
                          'licenseExpiry',
                          e.target
                            .value
                        )
                    }
                  />
                </label>
              </>
            )}

            {form.role ===
              'STUDENT' && (
              <>
                <label>
                  Course

                  <input
                    value={
                      form.course
                    }
                    onChange={
                      e =>
                        change(
                          'course',
                          e.target
                            .value
                        )
                    }
                    placeholder="BE CSE"
                  />
                </label>

                <label>
                  Semester

                  <input
                    value={
                      form.semester
                    }
                    onChange={
                      e =>
                        change(
                          'semester',
                          e.target
                            .value
                        )
                    }
                    placeholder="5"
                  />
                </label>
                <label>
                  Guardian mobile (automatic Parent linking)
                  <input
                    value={form.guardianPhone}
                    onChange={e => change('guardianPhone', e.target.value)}
                    placeholder="Parent's registered mobile"
                    inputMode="tel"
                    required
                  />
                </label>
              </>
            )}

            {form.role ===
              'STAFF' && (
              <label>
                Department

                <input
                  value={
                    form.department
                  }
                  onChange={
                    e =>
                      change(
                        'department',
                        e.target
                          .value
                      )
                  }
                  placeholder="Computer Science and Engineering"
                />
              </label>
            )}

            {form.role === 'PARENT' && (
              <p className="full-row" style={{color:'#8fc9e5',fontSize:12}}>
                Parent accounts link automatically when the registered phone matches
                a Student's guardian mobile. No Student ID is needed.
              </p>
            )}

            <div className="full-row">
              <button
                className="primary"
                disabled={
                  busy
                }
              >
                {busy
                  ? 'Creating…'
                  : 'Create login'}
              </button>

              <button
                type="button"
                className="secondary"
                onClick={
                  resetForm
                }
              >
                Clear
              </button>
            </div>
          </form>
        </section>
      )}

      {/* ======================================
          USERS DIRECTORY
      ====================================== */}

      <style>{`
        .users-directory-head{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:16px}
        .users-directory-head h3{margin:0 0 5px;color:#edf7ff;font-size:18px}.users-directory-head p{margin:0;color:#708ca4;font-size:12px}
        .users-search{width:min(360px,100%)}
        .users-main-table{min-width:900px}.users-main-table th{font-size:10px!important}.users-main-table td{font-size:12px!important;padding-top:14px!important;padding-bottom:14px!important}
        .user-identity{display:flex;align-items:center;gap:11px;min-width:230px}.user-avatar{width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,#168df5,#1264d3);display:grid;place-items:center;color:#fff;font-weight:900;flex:none}.user-identity b{display:block;color:#eaf6ff;font-size:12px}.user-identity small{display:block;margin-top:3px;color:#66839b;font-size:10px}
        .role-pill{display:inline-flex;padding:5px 9px;border-radius:999px;background:#0b2940;border:1px solid #164365;color:#8ecbfa;font-size:9px;font-weight:900;letter-spacing:.04em}.role-pill.driver{background:rgba(37,140,255,.12);color:#68bdff}.role-pill.student{background:rgba(46,205,148,.09);color:#6addb2}.role-pill.parent{background:rgba(174,120,255,.1);color:#c3a4ff}.role-pill.staff{background:rgba(255,184,77,.09);color:#ffc86f}
        .driver-detail-btn{white-space:nowrap}.driver-modal-backdrop{position:fixed;inset:0;background:rgba(0,8,17,.74);backdrop-filter:blur(7px);z-index:1000;display:grid;place-items:center;padding:24px}.driver-modal{width:min(820px,96vw);max-height:90vh;overflow:auto;background:#081b2c;border:1px solid rgba(101,174,231,.18);border-radius:18px;box-shadow:0 28px 80px rgba(0,0,0,.45);padding:22px}.driver-modal-head{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;padding-bottom:17px;border-bottom:1px solid rgba(105,165,215,.1)}.driver-modal-head h3{margin:3px 0 5px;color:#edf7ff;font-size:20px}.driver-modal-head p{margin:0;color:#708ca4;font-size:11px}.driver-modal-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:18px}.driver-detail-card{padding:14px;border:1px solid rgba(105,165,215,.1);border-radius:12px;background:#061725}.driver-detail-card small{display:block;color:#67859d;font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:.07em}.driver-detail-card b{display:block;margin-top:6px;color:#e6f3fd;font-size:12px}.driver-license-photo{width:100%;height:230px;object-fit:contain;background:#fff;border-radius:12px;margin-top:8px}.driver-review{grid-column:1/-1;padding:16px;border:1px solid rgba(105,165,215,.1);border-radius:12px;background:#071827}.driver-review-row{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end}.driver-review-actions{display:flex;gap:8px;flex-wrap:wrap}.driver-phone-row{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:8px}
        @media(max-width:760px){.users-directory-head{align-items:stretch;flex-direction:column}.users-search{width:100%}.driver-modal-grid{grid-template-columns:1fr}.driver-review-row,.driver-phone-row{grid-template-columns:1fr}.driver-review{grid-column:auto}}
      `}</style>

      <section className="panel">
        <div className="users-directory-head">
          <div>
            <span className="eyebrow">ACCOUNT DIRECTORY</span>
            <h3>NaviGuard members</h3>
            <p>{filteredUsers.length} account{filteredUsers.length === 1 ? '' : 's'} shown</p>
          </div>
          <input
            className="users-search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, email, ID or phone…"
          />
        </div>

        <div className="table-wrap">
          <table className="users-main-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Institution ID</th>
                <th>Route</th>
                <th>Pickup</th>
                <th>Phone</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map(user => {
                const isDriver = user.role === 'DRIVER';
                return (
                  <tr key={user.id}>
                    <td>
                      <div className="user-identity">
                        <div className="user-avatar">{(user.name || 'U').trim().charAt(0).toUpperCase()}</div>
                        <div>
                          <b>{user.name}</b>
                          <small>{user.email}</small>
                        </div>
                      </div>
                    </td>
                    <td><span className={`role-pill ${String(user.role || '').toLowerCase()}`}>{user.role}</span></td>
                    <td>{user.institutionId || '—'}</td>
                    <td>{user.assignedRoute?.code || '—'}</td>
                    <td>{user.pickupStop?.name || '—'}</td>
                    <td>{user.phone || '—'}</td>
                    <td>
                      {isDriver ? (
                        <button type="button" className="secondary driver-detail-btn" onClick={() => setSelectedDriver(user)}>
                          View driver details
                        </button>
                      ) : ['STUDENT','PARENT'].includes(user.role) ? (
                        <div style={{display:'grid',gap:5,minWidth:180}}>
                          <small style={{color:'#8aa5ba'}}>{user.role === 'STUDENT' ? 'Guardian mobile' : 'Parent mobile'}</small>
                          <input style={{minWidth:150,width:'100%'}} inputMode="tel"
                            value={guardianContacts[user.id] ?? ''}
                            onChange={e => setGuardianContacts(prev => ({...prev,[user.id]:e.target.value}))}
                            placeholder="10-digit mobile" />
                          <button type="button" className="secondary" disabled={savingId === user.id}
                            onClick={() => saveGuardianContact(user)}>
                            {savingId === user.id ? 'Saving…' : 'Save contact / auto-link'}
                          </button>
                          {user.role === 'PARENT' && <small style={{color:user.parentProfile?.studentId?'#67c7a5':'#e6af61'}}>
                            {user.parentProfile?.studentId ? 'Linked to student' : 'Awaiting matching student'}
                          </small>}
                        </div>
                      ) : <span style={{color:'#58758d'}}>—</span>}
                    </td>
                  </tr>
                );
              })}
              {!filteredUsers.length && (
                <tr><td colSpan="7"><div className="empty">No matching users found.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedDriver && (() => {
        const user = users.find(item => item.id === selectedDriver.id) || selectedDriver;
        const profile = user.driverProfile || {};
        const status = profile.licenseStatus || 'PENDING';
        const isReviewing = reviewingId === user.id;
        return (
          <div className="driver-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setSelectedDriver(null); }}>
            <section className="driver-modal">
              <div className="driver-modal-head">
                <div>
                  <span className="eyebrow">DRIVER ACCOUNT</span>
                  <h3>{user.name}</h3>
                  <p>{user.email} · {user.institutionId || 'No institution ID'}</p>
                </div>
                <button type="button" className="secondary" onClick={() => setSelectedDriver(null)}>Close</button>
              </div>

              <div className="driver-modal-grid">
                <div className="driver-detail-card"><small>Licence number</small><b>{profile.licenseNumber || 'Not provided'}</b></div>
                <div className="driver-detail-card"><small>Licence expiry</small><b>{profile.licenseExpiry ? new Date(profile.licenseExpiry).toLocaleDateString('en-IN') : 'Not provided'}</b></div>
                <div className="driver-detail-card"><small>Verification status</small><b><span className="chip" style={{...getStatusStyle(status),fontWeight:800}}>{status}</span></b></div>
                <div className="driver-detail-card">
                  <small>Driver phone</small>
                  <div className="driver-phone-row">
                    <input value={draftPhones[user.id] ?? user.phone ?? ''} onChange={e => setDraftPhones(current => ({...current,[user.id]:e.target.value}))} placeholder="Driver phone" inputMode="tel" />
                    <button type="button" className="secondary" onClick={() => savePhone(user.id)} disabled={savingId === user.id}>{savingId === user.id ? 'Saving…' : 'Save phone'}</button>
                  </div>
                </div>

                <div className="driver-detail-card" style={{gridColumn:'1 / -1'}}>
                  <small>Licence photo</small>
                  {profile.licensePhoto ? <img className="driver-license-photo" src={profile.licensePhoto} alt={`${user.name} licence`} /> : <div className="empty" style={{marginTop:10}}>No licence photo uploaded.</div>}
                </div>

                <div className="driver-review">
                  <div className="driver-review-row">
                    <label>
                      Review note / rejection reason
                      <input value={reviewNotes[user.id] || ''} onChange={e => setReviewNotes(current => ({...current,[user.id]:e.target.value}))} placeholder="Required only when rejecting" />
                    </label>
                    <div className="driver-review-actions">
                      <button type="button" className="primary" disabled={isReviewing} onClick={() => reviewLicense(user.id,'VERIFIED')}>{isReviewing && reviewingAction === 'VERIFIED' ? 'Verifying…' : '✓ Verify licence'}</button>
                      <button type="button" className="secondary" disabled={isReviewing} onClick={() => reviewLicense(user.id,'REJECTED')}>{isReviewing && reviewingAction === 'REJECTED' ? 'Rejecting…' : '✕ Reject'}</button>
                    </div>
                  </div>
                  {profile.licenseReviewNote && <small className="block" style={{marginTop:12,color:'#8aa5ba'}}>Last review note: {profile.licenseReviewNote}</small>}
                  {profile.licenseReviewedAt && <small className="block" style={{marginTop:5,color:'#66839b'}}>Reviewed {new Date(profile.licenseReviewedAt).toLocaleString('en-IN')}</small>}
                </div>
              </div>
            </section>
          </div>
        );
      })()}
    </>
  );
}