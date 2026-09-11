import { openDB } from 'idb'
const dbPromise = openDB('scanner-db', 1, { upgrade(db) { if (!db.objectStoreNames.contains('scans')) { const s=db.createObjectStore('scans',{keyPath:'id'}); s.createIndex('createdAt','createdAt') } } })
export async function listScans(){return (await dbPromise).getAllFromIndex('scans','createdAt')}
export async function putScan(scan){return (await dbPromise).put('scans',scan)}
export async function removeScan(id){return (await dbPromise).delete('scans',id)}
