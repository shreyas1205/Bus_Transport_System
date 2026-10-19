import {

  useEffect,

  useRef,

  useState

} from 'react';



import { api } from '../api';

import { useAuth } from '../auth';

import { io } from 'socket.io-client';
import { Html5Qrcode } from 'html5-qrcode';
import { queueOfflineRequest } from '../offlineQueue';



// ======================================================

// HELPERS

// ======================================================



function formatTime(value) {

  if (!value) {

    return '-';

  }



  return new Date(value).toLocaleTimeString(

    'en-IN',

    {

      hour: '2-digit',

      minute: '2-digit',

      second: '2-digit'

    }

  );

}



function formatDateTimeForCsv(value) {

  if (!value) {

    return '';

  }



  return new Date(value).toLocaleString(

    'en-IN',

    {

      day: '2-digit',

      month: '2-digit',

      year: 'numeric',

      hour: '2-digit',

      minute: '2-digit',

      second: '2-digit'

    }

  );

}



function formatReportDate(value) {

  if (!value) {

    return '';

  }



  const [

    year,

    month,

    day

  ] = value.split('-');



  return `${day}/${month}/${year}`;

}



function getLocalDateValue() {

  const now = new Date();



  const year =

    now.getFullYear();



  const month =

    String(

      now.getMonth() + 1

    ).padStart(2, '0');



  const day =

    String(

      now.getDate()

    ).padStart(2, '0');



  return `${year}-${month}-${day}`;

}



function isValidDateValue(value) {

  if (

    typeof value !== 'string' ||

    !/^\d{4}-\d{2}-\d{2}$/.test(value)

  ) {

    return false;

  }



  const [

    yearText,

    monthText,

    dayText

  ] = value.split('-');



  const year =

    Number(yearText);



  const month =

    Number(monthText);



  const day =

    Number(dayText);



  const date =

    new Date(

      year,

      month - 1,

      day

    );



  return (

    date.getFullYear() === year &&

    date.getMonth() === month - 1 &&

    date.getDate() === day

  );

}



function journeyLabel(status) {

  if (status === 'DROPPED_OFF') {

    return 'Dropped off';

  }



  if (status === 'BOARDED') {

    return 'Boarded';

  }



  return 'Not boarded';

}



function journeyText(status) {

  if (status === 'DROPPED_OFF') {

    return 'Dropped Off';

  }



  if (status === 'BOARDED') {

    return 'Boarded';

  }



  return 'Not Boarded';

}



function escapeCsvValue(value) {

  if (

    value === null ||

    value === undefined

  ) {

    return '""';

  }



  const text =

    String(value)

      .replace(/"/g, '""');



  return `"${text}"`;

}



function escapeHtml(value) {

  return String(

    value ?? ''

  )

    .replace(

      /&/g,

      '&amp;'

    )

    .replace(

      /</g,

      '&lt;'

    )

    .replace(

      />/g,

      '&gt;'

    )

    .replace(

      /"/g,

      '&quot;'

    )

    .replace(

      /'/g,

      '&#039;'

    );

}



// ======================================================

// COMPONENT

// ======================================================



export default function Boarding() {

  const { user } =

    useAuth();



  const [

    identifier,

    setIdentifier

  ] = useState('');



  const [

    status,

    setStatus

  ] = useState(null);



  const [

    events,

    setEvents

  ] = useState([]);



  const [

    roster,

    setRoster

  ] = useState(null);



  const [

    loadingRoster,

    setLoadingRoster

  ] = useState(false);



  const [

    loadingEvents,

    setLoadingEvents

  ] = useState(false);



  const [
    scanning,
    setScanning
  ] = useState(false);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraMessage, setCameraMessage] = useState('');
  const qrScannerRef = useRef(null);



  const [

    updatingStudentId,

    setUpdatingStudentId

  ] = useState('');



  const [

    droppingStudentId,

    setDroppingStudentId

  ] = useState('');



  // ====================================================

  // HISTORY

  // ====================================================



  const today =

    getLocalDateValue();



  const [

    historyDate,

    setHistoryDate

  ] = useState(today);



  const [

    historyRouteId,

    setHistoryRouteId

  ] = useState('');



  const [

    history,

    setHistory

  ] = useState(null);



  const [

    loadingHistory,

    setLoadingHistory

  ] = useState(false);



  const isDriver =

    user?.role === 'DRIVER';



 const canViewHistory =

  user?.role === 'ADMIN';



  // ====================================================

  // LOAD TODAY EVENTS

  // ====================================================



  async function load() {

    try {

      setLoadingEvents(true);



      const response =

        await api.get(

          '/boarding/today'

        );



      setEvents(

        Array.isArray(

          response.data

        )

          ? response.data

          : []

      );

    } catch (error) {

      setStatus({

        ok: false,

        text:

          error.response?.data

            ?.message ||

          "Could not load today's attendance."

      });

    } finally {

      setLoadingEvents(false);

    }

  }



  // ====================================================

  // LOAD DRIVER ROSTER

  // ====================================================



  async function loadRoster() {

    if (!isDriver) {

      return;

    }



    try {

      setLoadingRoster(true);



      const response =

        await api.get(

          '/boarding/driver-roster'

        );



      setRoster(

        response.data

      );

    } catch (error) {

      setStatus({

        ok: false,

        text:

          error.response?.data

            ?.message ||

          "Could not load today's route roster."

      });

    } finally {

      setLoadingRoster(false);

    }

  }



  // ====================================================

  // LOAD JOURNEY HISTORY

  // ====================================================



  async function loadHistory(

    date = historyDate,

    routeId = historyRouteId

  ) {

    if (!canViewHistory) {

      return;

    }



    if (!isValidDateValue(date)) {

      return;

    }



    try {

      setLoadingHistory(true);



      const params = {

        date

      };



      if (routeId) {

        params.routeId =

          routeId;

      }



      const response =

        await api.get(

          '/boarding/history',

          {

            params

          }

        );



      setHistory(

        response.data

      );



      setStatus(current => {

        if (

          current?.ok === false &&

          current?.text?.includes(

            'Invalid date'

          )

        ) {

          return null;

        }



        return current;

      });

    } catch (error) {

      setStatus({

        ok: false,

        text:

          error.response?.data

            ?.message ||

          'Could not load daily journey history.'

      });

    } finally {

      setLoadingHistory(false);

    }

  }



  // ====================================================

  // CSV EXPORT

  // ====================================================



  function exportJourneyCsv() {

    if (

      !history?.records?.length

    ) {

      setStatus({

        ok: false,

        text:

          'There are no journey records to export.'

      });



      return;

    }



    if (

      !isValidDateValue(

        historyDate

      )

    ) {

      setStatus({

        ok: false,

        text:

          'Select a valid date before exporting.'

      });



      return;

    }



    const headers = [

      'Student Name',

      'Student ID',

      'Phone',

      'Route Code',

      'Route Name',

      'Bus Number',

      'Registration Number',

      'Pickup Stop',

      'Journey Status',

      'Boarded At',

      'Dropped Off At',

      'Boarding Method',

      'Driver Name',

      'Driver Phone'

    ];



    const rows =

      history.records.map(

        record => [

          record.student?.name || '',

          record.student?.institutionId || '',

          record.student?.phone || '',

          record.route?.code || '',

          record.route?.name || '',

          record.route?.busNumber || '',

          record.route?.registrationNo || '',

          record.pickupStop || '',

          journeyText(record.status),

          formatDateTimeForCsv(

            record.boardedAt

          ),

          formatDateTimeForCsv(

            record.droppedOffAt

          ),

          record.boardingMethod || '',

          record.route?.driver?.name || '',

          record.route?.driver?.phone || ''

        ]

      );



    const csvLines = [

      headers

        .map(

          escapeCsvValue

        )

        .join(','),



      ...rows.map(

        row =>

          row

            .map(

              escapeCsvValue

            )

            .join(',')

      )

    ];



    const csvContent =

      '\uFEFF' +

      csvLines.join('\r\n');



    const blob =

      new Blob(

        [csvContent],

        {

          type:

            'text/csv;charset=utf-8;'

        }

      );



    const url =

      URL.createObjectURL(

        blob

      );



    const selectedRoute =

      history?.routes?.find(

        route =>

          route.id ===

          historyRouteId

      );



    const routeName =

      selectedRoute?.code

        ? selectedRoute.code.replace(

            /[^a-zA-Z0-9-_]/g,

            '-'

          )

        : 'all-routes';



    const fileName =

      `naviguard-journey-${historyDate}-${routeName}.csv`;



    const link =

      document.createElement(

        'a'

      );



    link.href =

      url;



    link.download =

      fileName;



    document.body.appendChild(

      link

    );



    link.click();



    document.body.removeChild(

      link

    );



    URL.revokeObjectURL(

      url

    );



    setStatus({

      ok: true,

      text:

        'Journey CSV report exported successfully.'

    });

  }



  // ====================================================

  // PDF EXPORT

  // ====================================================



  function exportJourneyPdf() {

    if (

      !history?.records?.length

    ) {

      setStatus({

        ok: false,

        text:

          'There are no journey records to export.'

      });



      return;

    }



    if (

      !isValidDateValue(

        historyDate

      )

    ) {

      setStatus({

        ok: false,

        text:

          'Select a valid date before exporting.'

      });



      return;

    }



    const selectedRoute =

      history?.routes?.find(

        route =>

          route.id ===

          historyRouteId

      );



    const routeTitle =

      selectedRoute

        ? `${selectedRoute.code} - ${selectedRoute.name}`

        : 'All Routes';



    const summary =

      history?.summary || {

        total: 0,

        notBoarded: 0,

        boarded: 0,

        droppedOff: 0

      };



    const rows =

      history.records

        .map(

          record => `

            <tr>

              <td>

                ${escapeHtml(

                  record.student?.name ||

                  '-'

                )}

              </td>



              <td>

                ${escapeHtml(

                  record.student?.institutionId ||

                  '-'

                )}

              </td>



              <td>

                ${escapeHtml(

                  record.route

                    ? `${record.route.code} - ${record.route.name}`

                    : '-'

                )}

              </td>



              <td>

                ${escapeHtml(

                  record.route?.busNumber ||

                  record.route?.registrationNo ||

                  '-'

                )}

              </td>



              <td>

                ${escapeHtml(

                  record.pickupStop ||

                  '-'

                )}

              </td>



              <td>

                ${escapeHtml(

                  journeyText(

                    record.status

                  )

                )}

              </td>



              <td>

                ${escapeHtml(

                  formatTime(

                    record.boardedAt

                  )

                )}

              </td>



              <td>

                ${escapeHtml(

                  formatTime(

                    record.droppedOffAt

                  )

                )}

              </td>



              <td>

                ${escapeHtml(

                  record.boardingMethod ||

                  '-'

                )}

              </td>

            </tr>

          `

        )

        .join('');



    const reportWindow =

      window.open(

        '',

        '_blank',

        'width=1200,height=800'

      );



    if (!reportWindow) {

      setStatus({

        ok: false,

        text:

          'Pop-up blocked. Allow pop-ups for this site and try again.'

      });



      return;

    }



    reportWindow.document.write(`

      <!DOCTYPE html>



      <html>

        <head>

          <meta charset="UTF-8" />



          <title>

            NaviGuard Journey Report

          </title>



          <style>

            \* {

              box-sizing: border-box;

            }



            body {

              font-family:

                Arial,

                Helvetica,

                sans-serif;



              margin: 30px;



              color: #172033;



              background: white;

            }



            .header {

              border-bottom:

                3px solid #1f4ed8;



              padding-bottom: 16px;



              margin-bottom: 22px;

            }



            .brand {

              font-size: 28px;



              font-weight: 800;



              color: #1f4ed8;

            }



            h1 {

              margin:

                8px 0 5px;



              font-size: 22px;

            }



            .sub {

              color: #5f6877;



              font-size: 13px;

            }



            .details {

              display: grid;



              grid-template-columns:

                repeat(2, 1fr);



              gap: 10px;



              margin-bottom: 20px;



              font-size: 13px;

            }



            .details-box {

              border:

                1px solid #dfe4ec;



              padding: 10px;



              border-radius: 7px;

            }



            .summary {

              display: grid;



              grid-template-columns:

                repeat(4, 1fr);



              gap: 10px;



              margin:

                18px 0 24px;

            }



            .summary-card {

              border:

                1px solid #dfe4ec;



              padding: 12px;



              border-radius: 7px;



              text-align: center;

            }



            .summary-card strong {

              display: block;



              font-size: 22px;



              margin-top: 5px;

            }



            table {

              width: 100%;



              border-collapse:

                collapse;



              font-size: 11px;

            }



            th {

              background: #eef3ff;



              padding: 9px 6px;



              border:

                1px solid #ccd4e0;



              text-align: left;

            }



            td {

              padding: 8px 6px;



              border:

                1px solid #dfe4ec;



              vertical-align: top;

            }



            tr {

              page-break-inside:

                avoid;

            }



            .footer {

              margin-top: 25px;



              border-top:

                1px solid #dfe4ec;



              padding-top: 10px;



              color: #6c7480;



              font-size: 10px;



              text-align: center;

            }



            @page {

              size: A4 landscape;



              margin: 12mm;

            }



            @media print {

              body {

                margin: 0;

              }

            }

          </style>

        </head>



        <body>



          <div class="header">

            <div class="brand">

              NaviGuard

            </div>



            <h1>

              Daily Journey Report

            </h1>



            <div class="sub">

              Student boarding and drop-off attendance report

            </div>

          </div>



          <div class="details">



            <div class="details-box">

              <strong>

                Report Date

              </strong>



              <br />



              ${escapeHtml(

                formatReportDate(

                  historyDate

                )

              )}

            </div>



            <div class="details-box">

              <strong>

                Route

              </strong>



              <br />



              ${escapeHtml(

                routeTitle

              )}

            </div>



          </div>



          <div class="summary">



            <div class="summary-card">

              Total Students



              <strong>

                ${summary.total}

              </strong>

            </div>



            <div class="summary-card">

              Not Boarded



              <strong>

                ${summary.notBoarded}

              </strong>

            </div>



            <div class="summary-card">

              Currently Boarded



              <strong>

                ${summary.boarded}

              </strong>

            </div>



            <div class="summary-card">

              Dropped Off



              <strong>

                ${summary.droppedOff}

              </strong>

            </div>



          </div>



          <table>



            <thead>

              <tr>

                <th>Student</th>

                <th>ID</th>

                <th>Route</th>

                <th>Bus</th>

                <th>Pickup</th>

                <th>Status</th>

                <th>Boarded</th>

                <th>Dropped Off</th>

                <th>Method</th>

              </tr>

            </thead>



            <tbody>

              ${rows}

            </tbody>



          </table>



          <div class="footer">

            Generated by NaviGuard Management System

            |

            ${escapeHtml(

              new Date().toLocaleString(

                'en-IN'

              )

            )}

          </div>



        </body>

      </html>

    `);



    reportWindow.document.close();



    reportWindow.focus();



    setTimeout(

      () => {

        reportWindow.print();

      },

      500

    );



    setStatus({

      ok: true,

      text:

        'PDF report prepared. Select "Save as PDF" in the print window.'

    });

  }



  // ====================================================

  // INITIAL LOAD + SOCKET

  // ====================================================



  useEffect(() => {

    load();



    if (isDriver) {

      loadRoster();

    }



    if (canViewHistory) {

      loadHistory(

        today,

        ''

      );

    }



    const socket = io(

      import.meta.env

        .VITE_SOCKET_URL ||

        'http\://localhost:4000'

    );



    const refresh =

      () => {

        load();



        if (isDriver) {

          loadRoster();

        }

      };



    socket.on(

      'boarding:update',

      refresh

    );



    return () => {

      socket.off(

        'boarding:update',

        refresh

      );



      socket.disconnect();

    };

  }, [user?.role]);



  // ====================================================

  // DATE CHANGE

  // ====================================================



  function handleHistoryDateChange(

    event

  ) {

    const value =

      event.target.value;



    setHistoryDate(

      value

    );



    if (

      isValidDateValue(

        value

      )

    ) {

      loadHistory(

        value,

        historyRouteId

      );

    }

  }



  // ====================================================

  // ROUTE CHANGE

  // ====================================================



  function handleHistoryRouteChange(

    event

  ) {

    const value =

      event.target.value;



    setHistoryRouteId(

      value

    );



    if (

      isValidDateValue(

        historyDate

      )

    ) {

      loadHistory(

        historyDate,

        value

      );

    }

  }



  // ====================================================

  // TODAY BUTTON

  // ====================================================



  function selectToday() {

    const value =

      getLocalDateValue();



    setHistoryDate(

      value

    );



    loadHistory(

      value,

      historyRouteId

    );

  }



  // ====================================================

  // SCAN

  // ====================================================



  async function boardQrToken(rawToken) {
    const cleanIdentifier = String(rawToken || '').trim();

    if (!cleanIdentifier) {
      setStatus({
        ok: false,
        text: 'Scan a valid NaviGuard daily QR code.'
      });
      return false;
    }

    try {
      setScanning(true);
      setStatus(null);

      const payload = {
        identifier: cleanIdentifier,
        method: 'QR'
      };

      if (isDriver && !navigator.onLine) {
        queueOfflineRequest({
          method: 'post',
          url: '/boarding/scan',
          data: payload,
          kind: 'BOARDING',
          description: 'QR boarding scan',
          ownerUserId: user?.id || null
        });
        setStatus({
          ok: true,
          text: 'Offline: QR boarding action queued and will sync automatically.'
        });
        setIdentifier('');
        return true;
      }

      const response = await api.post('/boarding/scan', payload);

      setStatus({
        ok: true,
        text: `${response.data.user.name} marked boarded.`
      });

      setIdentifier('');
      await load();

      if (isDriver) {
        await loadRoster();
      }

      return true;
    } catch (error) {
      if (isDriver && !error.response) {
        queueOfflineRequest({
          method: 'post',
          url: '/boarding/scan',
          data: { identifier: cleanIdentifier, method: 'QR' },
          kind: 'BOARDING',
          description: 'QR boarding scan',
          ownerUserId: user?.id || null
        });
        setStatus({
          ok: true,
          text: 'Network unavailable: QR boarding action queued for automatic sync.'
        });
        setIdentifier('');
        return true;
      }

      setStatus({
        ok: false,
        text:
          error.response?.data?.message ||
          'QR verification failed.'
      });
      return false;
    } finally {
      setScanning(false);
    }
  }

  async function scan(event) {
    event.preventDefault();
    await boardQrToken(identifier);
  }

  async function stopCamera() {
    const scanner = qrScannerRef.current;
    qrScannerRef.current = null;

    if (scanner) {
      try {
        if (scanner.isScanning) {
          await scanner.stop();
        }
      } catch {
        // Camera may already be stopped.
      }

      try {
        scanner.clear();
      } catch {
        // Reader may already be cleared.
      }
    }

    setCameraOpen(false);
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraMessage('Camera access is not supported in this browser. Paste the daily QR token below.');
      return;
    }

    try {
      setCameraMessage('');
      setCameraOpen(true);

      // Wait for React to render #campusbus-qr-reader.
      await new Promise(resolve => setTimeout(resolve, 50));

      const scanner = new Html5Qrcode('campusbus-qr-reader');
      qrScannerRef.current = scanner;

      const cameras = await Html5Qrcode.getCameras();
      if (!cameras?.length) {
        throw new Error('No camera found');
      }

      const preferred =
        cameras.find(camera => /back|rear|environment/i.test(camera.label)) ||
        cameras[cameras.length - 1];

      await scanner.start(
        preferred.id,
        {
          fps: 10,
          qrbox: { width: 230, height: 230 },
          aspectRatio: 1.333333
        },
        async decodedText => {
          if (!decodedText || scanning) return;

          await stopCamera();
          setIdentifier(decodedText);
          await boardQrToken(decodedText);
        },
        () => {
          // Normal scan misses are ignored while the camera continues.
        }
      );
    } catch (error) {
      await stopCamera();
      setCameraMessage(
        error?.message === 'No camera found'
          ? 'No camera was found on this device. Paste the daily QR token below.'
          : 'Camera permission was denied or the camera could not start. Paste the daily QR token below.'
      );
    }
  }

  useEffect(() => {
    return () => {
      const scanner = qrScannerRef.current;
      qrScannerRef.current = null;
      if (scanner) {
        Promise.resolve(scanner.stop()).catch(() => {});
        try { scanner.clear(); } catch {}
      }
    };
  }, []);

  // ====================================================

  // BOARD / UNBOARD

  // ====================================================



  async function toggle(

    studentId,

    boarded

  ) {

    try {

      setUpdatingStudentId(

        studentId

      );



      setStatus(null);



      const payload = { studentId, boarded };

      if (isDriver && !navigator.onLine) {
        queueOfflineRequest({
          method: 'post',
          url: '/boarding/toggle',
          data: payload,
          kind: 'BOARDING',
          description: boarded ? 'Mark student boarded' : 'Undo student boarding',
          ownerUserId: user?.id || null
        });
        setStatus({
          ok: true,
          text: 'Offline: boarding action queued and will sync automatically.'
        });
        return;
      }

      const response =

        await api.post(

          '/boarding/toggle',

          payload

        );



      setStatus({

        ok: true,

        text:

          response.data.message

      });



      await loadRoster();



      await load();



      if (

        canViewHistory &&

        isValidDateValue(

          historyDate

        )

      ) {

        await loadHistory();

      }

    } catch (error) {

      if (isDriver && !error.response) {
        queueOfflineRequest({
          method: 'post',
          url: '/boarding/toggle',
          data: { studentId, boarded },
          kind: 'BOARDING',
          description: boarded ? 'Mark student boarded' : 'Undo student boarding',
          ownerUserId: user?.id || null
        });
        setStatus({
          ok: true,
          text: 'Network unavailable: boarding action queued for automatic sync.'
        });
        return;
      }

      setStatus({

        ok: false,

        text:

          error.response?.data

            ?.message ||

          'Could not update boarding status.'

      });



      if (isDriver) {

        await loadRoster();

      }

    } finally {

      setUpdatingStudentId('');

    }

  }



  // ====================================================

  // DROP OFF

  // ====================================================



  async function dropOff(

    studentId

  ) {

    try {

      setDroppingStudentId(

        studentId

      );



      setStatus(null);



      const payload = { studentId };

      if (isDriver && !navigator.onLine) {
        queueOfflineRequest({
          method: 'post',
          url: '/boarding/drop-off',
          data: payload,
          kind: 'BOARDING',
          description: 'Mark student dropped off',
          ownerUserId: user?.id || null
        });
        setStatus({
          ok: true,
          text: 'Offline: drop-off action queued and will sync automatically.'
        });
        return;
      }

      const response =

        await api.post(

          '/boarding/drop-off',

          payload

        );



      setStatus({

        ok: true,

        text:

          response.data.message

      });



      await loadRoster();



      await load();



      if (

        canViewHistory &&

        isValidDateValue(

          historyDate

        )

      ) {

        await loadHistory();

      }

    } catch (error) {

      if (isDriver && !error.response) {
        queueOfflineRequest({
          method: 'post',
          url: '/boarding/drop-off',
          data: { studentId },
          kind: 'BOARDING',
          description: 'Mark student dropped off',
          ownerUserId: user?.id || null
        });
        setStatus({
          ok: true,
          text: 'Network unavailable: drop-off action queued for automatic sync.'
        });
        return;
      }

      setStatus({

        ok: false,

        text:

          error.response?.data

            ?.message ||

          'Could not record drop-off.'

      });

    } finally {

      setDroppingStudentId('');

    }

  }



  // ====================================================

  // COUNTS

  // ====================================================



  const boardingEvents =

    events.filter(

      event =>

        event.status === 'BOARDED'

    );



  const dropOffEvents =

    events.filter(

      event =>

        event.status === 'DROPPED_OFF'

    );



  const rosterBoardedCount =

    roster?.students?.filter(

      student =>

        student.boarded

    ).length || 0;



  const rosterDroppedCount =

    roster?.students?.filter(

      student =>

        student.droppedOff

    ).length || 0;



  const rosterTotal =

    roster?.students?.length || 0;



  const historySummary =

    history?.summary || {

      total: 0,

      notBoarded: 0,

      boarded: 0,

      droppedOff: 0

    };



  // ====================================================

  // UI

  // ====================================================



  return (

    <>

      <div className="page-title boarding-page-title">

        <div>

          <span className="eyebrow">

            BOARDING CONTROL

          </span>



          <h2>

            Digital attendance

          </h2>



          <p>

            {isDriver

              ? 'Track boarding and safely record each student drop-off in real time.'

              : canViewHistory

              ? 'Monitor passenger boarding, drop-off and daily journey history.'

              : 'Manage passenger boarding activity.'}

          </p>

        </div>

      </div>



      {status && (

        <div

          className={

            status.ok

              ? 'success'

              : 'error'

          }

        >

          {status.text}

        </div>

      )}



      {isDriver && (
        <section className="panel boarding-qr-console">
          <div className="panel-head">
            <div>
              <span className="eyebrow">DRIVER QR SCANNER</span>
              <h3>Scan Student Daily QR</h3>
              <p>Only a valid NaviGuard daily QR can board a student.</p>
            </div>
            <span className="chip good">ASSIGNED ROUTE ONLY</span>
          </div>

          <div className="boarding-camera-layout">
            <div className="boarding-camera-box">
              {cameraOpen ? (
                <div id="campusbus-qr-reader" className="boarding-html5-reader" />
              ) : (
                <div className="boarding-camera-placeholder">
                  <div className="boarding-qr-symbol">QR</div>
                  <strong>Camera scanner ready</strong>
                  <span>Use the rear camera to scan the student's daily QR.</span>
                </div>
              )}
            </div>

            <div className="boarding-camera-actions">
              {!cameraOpen ? (
                <button type="button" className="primary" onClick={startCamera} disabled={scanning}>
                  Open QR Camera
                </button>
              ) : (
                <button type="button" className="secondary" onClick={stopCamera}>
                  Stop Camera
                </button>
              )}

              {cameraMessage && <div className="hint">{cameraMessage}</div>}

              <form onSubmit={scan} className="stack boarding-token-fallback">
                <label>
                  QR token fallback
                  <input
                    value={identifier}
                    onChange={event => setIdentifier(event.target.value)}
                    placeholder="Paste scanned NaviGuard QR token"
                    autoComplete="off"
                  />
                </label>

                <button className="secondary" disabled={scanning || !identifier.trim()}>
                  {scanning ? 'Verifying...' : 'Verify QR'}
                </button>
              </form>

              <div className="hint">
                Student ID/email/manual boarding is disabled. The student must present today's valid QR.
              </div>
            </div>
          </div>
        </section>
      )}

      {canViewHistory && (

        <>

          <section className="boarding-command-card">

            <div className="boarding-command-copy">

              <span className="eyebrow">JOURNEY CONTROLS</span>

              <h3>Daily journey report</h3>

              <p>Choose a date and route, then review or export passenger activity.</p>

            </div>



            <div className="boarding-command-fields">

              <label>

                <span>Date</span>

                <input

                  type="date"

                  value={historyDate}

                  max={getLocalDateValue()}

                  onChange={handleHistoryDateChange}

                />

              </label>



              <label>

                <span>Route</span>

                <select value={historyRouteId} onChange={handleHistoryRouteChange}>

                  <option value="">All routes</option>

                  {history?.routes?.map(route => (

                    <option key={route.id} value={route.id}>

                      {route.code} - {route.name}

                    </option>

                  ))}

                </select>

              </label>

            </div>



            <div className="boarding-command-actions">

              <button type="button" className="secondary" onClick={selectToday}>Today</button>

              <button

                type="button"

                className="secondary"

                disabled={loadingHistory || !isValidDateValue(historyDate)}

                onClick={() => loadHistory()}

              >

                {loadingHistory ? 'Refreshing...' : 'Refresh'}

              </button>

              <button

                type="button"

                className="secondary"

                disabled={loadingHistory || !history?.records?.length || !isValidDateValue(historyDate)}

                onClick={exportJourneyCsv}

              >

                Export CSV

              </button>

              <button

                type="button"

                className="primary"

                disabled={loadingHistory || !history?.records?.length || !isValidDateValue(historyDate)}

                onClick={exportJourneyPdf}

              >

                Export PDF

              </button>

            </div>

          </section>



          <div className="boarding-summary-grid">

            <section className="boarding-stat-card">

              <span className="boarding-stat-icon">Î£</span>

              <small>TOTAL STUDENTS</small>



              <h2>

                {historySummary.total}

              </h2>

            </section>



            <section className="boarding-stat-card waiting">

              <span className="boarding-stat-icon">N</span>

              <small>NOT BOARDED</small>



              <h2>

                {historySummary.notBoarded}

              </h2>

            </section>



            <section className="boarding-stat-card onboard">

              <span className="boarding-stat-icon">OK</span>

              <small>ON BOARD</small>



              <h2>

                {historySummary.boarded}

              </h2>

            </section>



            <section className="boarding-stat-card dropped">

              <span className="boarding-stat-icon">D</span>

              <small>DROPPED OFF</small>



              <h2>

                {historySummary.droppedOff}

              </h2>

            </section>

          </div>

          <section className="panel boarding-records-panel">



            <div className="panel-head">

              <div>

                <span className="eyebrow">PASSENGER LOG</span>

                <h3>

                  Student journey records

                </h3>



                <p>

                  {history?.records?.length || 0}

                  {' '}

                  student records

                </p>

              </div>

            </div>



            {loadingHistory &&

            !history ? (

              <div className="loading-card">

                Loading journey history...

              </div>

            ) : !history?.records?.length ? (

              <div className="empty">

                No students found for

                the selected date and

                route.

              </div>

            ) : (

              <div className="table-wrap">

                <table>



                  <thead>

                    <tr>

                      <th>Student</th>

                      <th>ID</th>

                      <th>Route</th>

                      <th>Bus</th>

                      <th>Pickup</th>

                      <th>Status</th>

                      <th>Boarded</th>

                      <th>Dropped off</th>

                      <th>Method</th>

                    </tr>

                  </thead>



                  <tbody>

                    {history.records.map(

                      record => (

                        <tr

                          key={

                            record.student.id

                          }

                        >

                          <td>

                            <b>

                              {record.student.name}

                            </b>



                            {record.student.phone && (

                              <small className="passenger-phone">

                                {record.student.phone}

                              </small>

                            )}

                          </td>



                          <td>

                            {record.student.institutionId || '-'}

                          </td>



                          <td>

                            {record.route

                              ? `${record.route.code} - ${record.route.name}`

                              : '-'}

                          </td>



                          <td>

                            {record.route?.busNumber ||

                              record.route?.registrationNo ||

                              '-'}

                          </td>



                          <td>

                            {record.pickupStop || '-'}

                          </td>



                          <td>

                            <span className="chip good">

                              {journeyLabel(

                                record.status

                              )}

                            </span>

                          </td>



                          <td>

                            {formatTime(

                              record.boardedAt

                            )}

                          </td>



                          <td>

                            {formatTime(

                              record.droppedOffAt

                            )}

                          </td>



                          <td>

                            {record.boardingMethod || '-'}

                          </td>

                        </tr>

                      )

                    )}

                  </tbody>



                </table>

              </div>

            )}

          </section>

        </>

      )}



      <div className="grid-2 boarding-control-grid">



        {isDriver && (

          <section className="panel boarding-roster-panel">



            <div className="panel-head">

              <div>

                <h3>

                  Today's route roster

                </h3>



                <p>

                  {roster?.route

                    ? `${roster.route.code} | ${roster.route.name} | Bus ${roster.route.busNumber || '-'}`

                    : 'No active route assigned to you.'}

                </p>

              </div>



              {roster?.route && (

                <div>

                  <span className="chip good">

                    {rosterBoardedCount}

                    /

                    {rosterTotal}

                    {' '}

                    boarded

                  </span>



                  {' '}



                  <span className="chip good">

                    {rosterDroppedCount}

                    {' '}

                    dropped

                  </span>

                </div>

              )}

            </div>



            {loadingRoster ? (

              <div className="loading-card">

                Loading students...

              </div>

            ) : !roster?.route ? (

              <div className="empty">

                No active route is assigned

                to this driver.

              </div>

            ) : !roster.students?.length ? (

              <div className="empty">

                No students are assigned

                to this route yet.

              </div>

            ) : (

              <div className="table-wrap">

                <table>



                  <thead>

                    <tr>

                      <th>Student</th>

                      <th>Pickup</th>

                      <th>Boarding</th>

                      <th>Boarded at</th>

                      <th>Drop-off</th>

                    </tr>

                  </thead>



                  <tbody>

                    {roster.students.map(

                      student => (

                        <tr

                          key={student.id}

                        >

                          <td>

                            <b>

                              {student.name}

                            </b>



                            <small className="passenger-phone">

                              {student.institutionId || '-'}

                            </small>

                          </td>



                          <td>

                            {student.pickupStop}

                          </td>



                          <td>

                            {student.droppedOff ? (
                              <span className="chip good">Journey complete</span>
                            ) : student.boarded ? (
                              <span className="chip good">Boarded by QR</span>
                            ) : (
                              <span className="chip">Waiting for QR</span>
                            )}

                          </td>



                          <td>

                            {student.boardedAt

                              ? formatTime(

                                  student.boardedAt

                                )

                              : '-'}

                          </td>



                          <td>

                            {student.droppedOff ? (

                              <div>

                                <span className="chip good">

                                  Dropped off

                                </span>



                                <small className="passenger-phone">

                                  {formatTime(

                                    student.droppedOffAt

                                  )}

                                </small>

                              </div>

                            ) : student.boarded ? (

                              <button

                                type="button"

                                className="primary small"

                                disabled={

                                  droppingStudentId ===

                                  student.id

                                }

                                onClick={() =>

                                  dropOff(

                                    student.id

                                  )

                                }

                              >

                                {droppingStudentId ===

                                student.id

                                  ? 'Saving...'

                                  : 'Mark dropped off'}

                              </button>

                            ) : (

                              <span>

                                Board first

                              </span>

                            )}

                          </td>

                        </tr>

                      )

                    )}

                  </tbody>



                </table>

              </div>

            )}

          </section>

        )}



        <section

          className="panel boarding-events-panel"

          style={{

            gridColumn: '1 / -1'

          }}

        >



          <div className="panel-head">

            <div>

              <h3>

                Today's journey events

              </h3>



              <p>

                {boardingEvents.length}

                {' '}

                boardings |{' '}

                {dropOffEvents.length}

                {' '}

                drop-offs

              </p>

            </div>



            <button

              type="button"

              className="secondary"

              onClick={load}

              disabled={

                loadingEvents

              }

            >

              {loadingEvents

                ? 'Refreshing...'

                : 'Refresh'}

            </button>

          </div>



          {loadingEvents &&

          !events.length ? (

            <div className="loading-card">

              Loading attendance...

            </div>

          ) : !events.length ? (

            <div className="empty">

              No journey events have

              been recorded today.

            </div>

          ) : (

            <div className="table-wrap">

              <table>



                <thead>

                  <tr>

                    <th>Time</th>

                    <th>Passenger</th>

                    <th>ID</th>

                    <th>Role</th>

                    <th>Event</th>

                    <th>Method</th>

                  </tr>

                </thead>



                <tbody>

                  {events.map(

                    event => (

                      <tr

                        key={event.id}

                      >

                        <td>

                          {formatTime(

                            event.scannedAt

                          )}

                        </td>



                        <td>

                          <b>

                            {event.user?.name}

                          </b>

                        </td>



                        <td>

                          {event.user?.institutionId || '-'}

                        </td>



                        <td>

                          <span className="chip good">

                            {event.user?.role || '-'}

                          </span>

                        </td>



                        <td>

                          <span className="chip good">

                            {event.status ===

                            'DROPPED_OFF'

                              ? 'DROPPED OFF'

                              : event.status}

                          </span>

                        </td>



                        <td>

                          {event.method || '-'}

                        </td>

                      </tr>

                    )

                  )}

                </tbody>



              </table>

            </div>

          )}

        </section>



      </div>

    </>

  );

}
