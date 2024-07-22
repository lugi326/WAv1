// firebaseService.js
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://dbwa-658de-default-rtdb.asia-southeast1.firebasedatabase.app/' // Ganti dengan URL database Anda
});

const db = admin.database();

const getData = async (path) => {
  try {
    const ref = db.ref(path);
    const snapshot = await ref.once('value');
    return snapshot.val();
  } catch (error) {
    console.error('Error saat mengambil data:', error);
    throw error;
  }
};

const setData = async (path, data) => {
  try {
    const ref = db.ref(path);
    await ref.set(data);
    console.log('Data berhasil disimpan:', data);
  } catch (error) {
    console.error('Error saat menyimpan data:', error);
    throw error;
  }
};

const updateData = async (path, data) => {
  try {
    const ref = db.ref(path);
    await ref.update(data);
    console.log('Data berhasil diperbarui:', data);
  } catch (error) {
    console.error('Error saat memperbarui data:', error);
    throw error;
  }
};

const deleteData = async (path) => {
  try {
    const ref = db.ref(path);
    await ref.remove();
    console.log('Data berhasil dihapus');
  } catch (error) {
    console.error('Error saat menghapus data:', error);
    throw error;
  }
};

const addTask = async (dosen, namaTugas, deadline) => {
  try {
    const ref = db.ref('tugas');
    const newTaskRef = ref.push();
    const taskData = { dosen, namaTugas, deadline };
    await newTaskRef.set(taskData);
    console.log('Tugas berhasil ditambahkan:', taskData);
  } catch (error) {
    console.error('Error saat menambahkan tugas:', error);
    throw error;
  }
};

const getAllTasks = async () => {
  try {
    const tasks = await getData('tugas');
    return tasks;
  } catch (error) {
    console.error('Error saat mengambil semua tugas:', error);
    throw error;
  }
};

module.exports = {
  getData,
  setData,
  updateData,
  deleteData,
  addTask,
  getAllTasks
};