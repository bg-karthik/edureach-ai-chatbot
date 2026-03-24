# 🎓 EduReach College Chatbot & Voice Agent

An AI-powered college assistant that helps students with course information, admissions, and counseling through both **chat** and **voice calls**.

---

## 🚀 Features

* 💬 AI Chatbot (RAG-based using Gemini + MongoDB)
* 📞 Voice Call Agent (Vapi integration)
* 🔐 User Authentication (JWT)
* 📚 Knowledge Base (course, fees, admissions)
* ⚡ Real-time responses
* 🎯 Personalized counseling experience

---

## 🛠️ Tech Stack

### Frontend

* React (Vite)
* TypeScript
* Tailwind CSS

### Backend

* Node.js + Express
* MongoDB Atlas
* LangChain
* Google Gemini API

### Voice AI

* Vapi AI (outbound calling)

---

## 📂 Project Structure

```
client/                # Frontend (React)
server/                # Backend (Node.js)
server/src/
  ├── controllers/
  ├── routes/
  ├── services/
  ├── models/
  └── utils/
```

---

## ⚙️ Setup Instructions

### 1️⃣ Clone Repository

```
git clone https://github.com/your-username/your-repo.git
cd your-repo
```

---

### 2️⃣ Install Dependencies

#### Frontend

```
cd client/edureach-platform
npm install
```

#### Backend

```
cd ../../server
npm install
```

---

### 3️⃣ Configure Environment Variables

Create a `.env` file inside `server/`:

```
PORT=5000
NODE_ENV=development

MONGODB_URI=your_mongodb_url

JWT_SECRET=your_secret
JWT_EXPIRES_IN=3d

CLIENT_URL=http://localhost:5173

GOOGLE_API_KEY=your_google_api_key

VAPI_API_KEY=your_vapi_api_key
VAPI_PHONE_NUMBER_ID=your_phone_id
VAPI_ASSISTANT_ID=your_assistant_id
```

---

### 4️⃣ Run the Project

#### Start Backend

```
cd server
npm run dev
```

#### Start Frontend

```
cd client/edureach-platform
npm run dev
```

---

## 🌐 URLs

* Frontend: http://localhost:5173
* Backend: http://localhost:5000

---

## 🧪 How to Test

### Chatbot

* Register/Login
* Open chat widget
* Ask questions like:

  * "What courses do you offer?"
  * "Tell me about placements"

### Voice Agent

* Click "Call Me"
* Enter phone number
* Receive AI call instantly

---

## ⚠️ Important Notes

* Do NOT upload `.env` file to GitHub
* Keep API keys secure
* Use `.env.example` for reference

---

## 📌 Future Improvements

* Voice → RAG integration (dynamic responses)
* Multi-language support
* Admin dashboard
* Analytics for conversations

---

## 👨‍💻 Author

Karthik

---

## 📄 License

This project is for educational purposes.
