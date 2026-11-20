import { Document, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer'

export interface DossierPdfSection {
  title: string
  rows: readonly (readonly [string, string])[]
  note?: string
}

interface DossierDocumentData {
  employeeNumber: string
  employeeName: string
  date: string
  includePay: boolean
  sections: readonly DossierPdfSection[]
}

const styles = StyleSheet.create({
  page: { paddingTop: 41, paddingHorizontal: 38, paddingBottom: 54, color: '#172b37', fontFamily: 'Helvetica', fontSize: 10 },
  letterhead: { borderBottom: '2 solid #137b61', paddingBottom: 14, marginBottom: 16 },
  company: { color: '#137b61', fontFamily: 'Helvetica-Bold', fontSize: 10, letterSpacing: 1.1 },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 25, marginTop: 4 },
  identity: { marginTop: 12, fontSize: 12, fontFamily: 'Helvetica-Bold' },
  date: { fontSize: 9, color: '#4f6470', marginTop: 4 },
  section: { marginBottom: 14 },
  sectionTitle: { fontFamily: 'Helvetica-Bold', fontSize: 12, backgroundColor: '#edf6f2', paddingVertical: 5, paddingHorizontal: 7 },
  note: { paddingTop: 6, paddingHorizontal: 7, color: '#4f6470' },
  row: { flexDirection: 'row', borderBottom: '1 solid #e0e8e4', padding: 6, gap: 9 },
  label: { width: '33%', color: '#4f6470' },
  value: { flex: 1 },
  footer: { position: 'absolute', top: 799, height: 19, left: 38, right: 38, borderTop: '1 solid #e0e8e4', paddingTop: 6, flexDirection: 'row', justifyContent: 'space-between', gap: 14, color: '#4f6470', fontSize: 8 },
})

function EmployeeDossierDocument({ data }: { data: DossierDocumentData }) {
  return (
    <Document title="Employee dossier" author="Egypro OneHub" subject="Confidential employee record" language="en-UG">
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.letterhead} wrap={false}>
          <Text style={styles.company}>EGYPRO ONEHUB</Text>
          <Text style={styles.title}>Employee dossier</Text>
          <Text style={styles.identity}>{data.employeeName} · {data.employeeNumber}</Text>
          <Text style={styles.date}>Generated {data.date} · {data.includePay ? 'Includes pay details' : 'Pay details excluded'}</Text>
        </View>
        {data.sections.map((section) => (
          <DossierSection key={section.title} section={section} />
        ))}
        <View style={styles.footer} fixed>
          <Text>Confidential employee record · {data.employeeNumber}</Text>
          <Text render={({ pageNumber, totalPages }) => pageNumber + ' / ' + totalPages} />
        </View>
      </Page>
    </Document>
  )
}

function DossierRow({ row: [label, value] }: { row: readonly [string, string] }) {
  return (
    <View style={styles.row} wrap={value.length > 240}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  )
}

function DossierSection({ section }: { section: DossierPdfSection }) {
  const [first, ...remaining] = section.rows
  return (
    <View style={styles.section}>
      <View wrap={Boolean(first && first[1].length > 240)}>
        <Text style={styles.sectionTitle} minPresenceAhead={32}>{section.title}</Text>
        {section.note && <Text style={styles.note}>{section.note}</Text>}
        {first && <DossierRow row={first} />}
      </View>
      {remaining.map((row, index) => <DossierRow key={row[0] + ':' + index} row={row} />)}
    </View>
  )
}

export async function prepareEmployeeDossierPdf(data: DossierDocumentData) {
  const blob = await pdf(<EmployeeDossierDocument data={data} />).toBlob()
  const fileNumber = data.employeeNumber.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 80)
  return () => {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `Employee-Dossier-${fileNumber || 'OneHub'}.pdf`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }
}
