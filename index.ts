import express, { Request, Response } from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { RowDataPacket } from 'mysql2';

// 載入環境變數
dotenv.config();

// 類型定義
interface Prize {
  id: number;
  name: string;
  total_quantity: number;
  remaining_quantity: number;
  color: string;
}


// 資料庫連線
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'mysql',
  port: Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Express設定
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 取得所有獎項
app.get('/api/prizes', async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT * FROM prizes');
    res.json(rows);
  } 
  catch (error) {
    console.error(error);
    res.status(500).json({ error: '取得獎項失敗' });
  }
});

// 加權隨機算法
function weightedRandom(prizes: Prize[]): Prize {

  const totalWeight = prizes.reduce((sum, prize) => sum + prize.total_quantity, 0);

  let random = Math.random() * totalWeight;
  
  for (const prize of prizes) {
    random -= prize.total_quantity;
    if (random <= 0) {
      return prize;
    }
  }
  
  return prizes[prizes.length - 1]; 
}

// 進行抽獎
app.post('/api/lottery/draw', async (req: Request, res: Response) => {

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 獲取所有有剩餘數量的獎項
    const [prizes] = await connection.execute<RowDataPacket[]>(
      'SELECT * FROM prizes WHERE remaining_quantity > 0 FOR UPDATE'
    );

    if (prizes.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: '沒有可用的獎項' });
    }

    // 根據機率進行抽獎
    const selectedPrize = weightedRandom(prizes as Prize[]);

    // 更新獎項剩餘數量
    await connection.execute(
      'UPDATE prizes SET remaining_quantity = remaining_quantity - 1 WHERE id = ? AND remaining_quantity > 0',
      [selectedPrize.id]
    );
    await connection.commit();

    res.json({
      prize: selectedPrize
    });

  } 
  catch (error) {
    await connection.rollback();
    console.error(error);
    res.status(500).json({ error: '抽獎失敗' });
  } 
  finally {
    connection.release();
  }
});


// 啟動伺服器
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

// 錯誤處理
process.on('unhandledRejection', (error) => {
  console.error(error);
});

process.on('uncaughtException', (error) => {
  console.error(error);
  process.exit(1);
});