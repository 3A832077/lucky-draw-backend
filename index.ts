import express, { Request, Response } from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

// 載入環境變數
dotenv.config();

// 類型定義
interface Prize {
  id: number;
  name: string;
  total_quantity: number;
  remaining_quantity: number;
  probability: number;
  color: string;
}

interface Participant {
  id: number;
  name: string;
}

interface LotteryRecord {
  id: number;
  participant_id: number;
  prize_id: number;
  lottery_time: Date;
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

// 獎項
// 取得所有獎項
app.get('/api/prizes', async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM prizes ORDER BY probability ASC'
    );
    res.json(rows);
  } 
  catch (error) {
    console.error('Error fetching prizes:', error);
    res.status(500).json({ error: 'Failed to fetch prizes' });
  }
});

// 更新獎項
app.put('/api/prizes/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, total_quantity, remaining_quantity, probability, color } = req.body;
    
    await pool.execute(
      'UPDATE prizes SET name = ?, total_quantity = ?, remaining_quantity = ?, probability = ?, color = ? WHERE id = ?',
      [name, total_quantity, remaining_quantity, probability, color, id]
    );
    
    res.json({ message: 'Prize updated successfully' });
  } 
  catch (error) {
    console.error('Error updating prize:', error);
    res.status(500).json({ error: 'Failed to update prize' });
  }
});

// 參與者
// 取得所有參與者
app.get('/api/participants', async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM participants ORDER BY name'
    );
    res.json(rows);
  } 
  catch (error) {
    console.error('Error fetching participants:', error);
    res.status(500).json({ error: 'Failed to fetch participants' });
  }
});

// 新增參與者（批次）
app.post('/api/participants', async (req: Request, res: Response) => {
  try {
    const { names } = req.body;
    
    if (!names || !Array.isArray(names) || names.length === 0) {
      return res.status(400).json({ error: 'Invalid participant names' });
    }
    
    const placeholders = names.map(() => '(?)').join(',');
    const query = `INSERT INTO participants (name) VALUES ${placeholders}`;
    
    await pool.execute(query, names);
    
    res.json({ message: 'Participants added successfully', count: names.length });
  } 
  catch (error) {
    console.error('Error adding participants:', error);
    res.status(500).json({ error: 'Failed to add participants' });
  }
});

// 抽獎
// 加權隨機算法
function weightedRandom(prizes: Prize[]): Prize {
  let random = Math.random() * 100;
  
  for (const prize of prizes) {
    random -= prize.probability;
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
        
        const { participantName } = req.body;
        
        if (!participantName) {
            return res.status(400).json({ error: 'Participant name is required' });
        }
        
        // 獲取或創建參與者
        let [participants] = await connection.execute<RowDataPacket[]>(
        'SELECT * FROM participants WHERE name = ?',
        [participantName]
        );
        
        let participantId: number;
        if (participants.length === 0) {
        const [result] = await connection.execute<ResultSetHeader>(
            'INSERT INTO participants (name) VALUES (?)',
            [participantName]
        );
        participantId = result.insertId;
        } 
        else {
        participantId = participants[0].id;
        }
        
        // 獲取所有有剩餘數量的獎項
        const [prizes] = await connection.execute<RowDataPacket[]>(
        'SELECT * FROM prizes WHERE remaining_quantity > 0'
        );
        
        if (prizes.length === 0) {
        await connection.rollback();
        return res.status(400).json({ error: 'No prizes available' });
        }
        
        // 根據機率進行抽獎
        const selectedPrize = weightedRandom(prizes as Prize[]);
        
        // 創建中獎記錄
        await connection.execute('INSERT INTO lottery_records (participant_id, prize_id) VALUES (?, ?)',
            [participantId, selectedPrize.id]
        );
        
        // 更新獎項剩餘數量
        await connection.execute('UPDATE prizes SET remaining_quantity = remaining_quantity - 1 WHERE id = ? AND remaining_quantity > 0', [selectedPrize.id]);
        await connection.commit();
        
        res.json({
            participant: { id: participantId, name: participantName },
            prize: selectedPrize
        });
    
    } 
        catch (error) {
            await connection.rollback();
            console.error('Error during lottery draw:', error);
            res.status(500).json({ error: 'Failed to draw lottery' });
        } 
        finally {
            connection.release();
        }
    });

    

// 取得中獎記錄
app.get('/api/lottery/records', async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(`
      SELECT 
        lr.id,
        lr.lottery_time,
        p.name as participant_name,
        pr.name as prize_name,
        pr.color as prize_color
      FROM lottery_records lr
      JOIN participants p ON lr.participant_id = p.id
      JOIN prizes pr ON lr.prize_id = pr.id
      ORDER BY lr.lottery_time DESC
      LIMIT 50
    `);
    
    res.json(rows);
  } 
  catch (error) {
    console.error('Error fetching lottery records:', error);
    res.status(500).json({ error: 'Failed to fetch lottery records' });
  }
});

// 啟動伺服器
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

// 錯誤處理
process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});