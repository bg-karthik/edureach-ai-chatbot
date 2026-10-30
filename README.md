
# 🎓 EduReach — AI Chatbot & Student Guidance Platform

**EduReach** is a full-stack college guidance platform that helps students explore academic programs, admissions, fees, scholarships, placements, and campus facilities through a conversational AI chatbot.

It combines **Retrieval-Augmented Generation (RAG)**, **Google Gemini**, and **MongoDB Atlas Vector Search** to generate answers grounded in a college knowledge base.

The application also includes student authentication and a **Vapi-powered outbound voice counseling integration** with persistent call tracking and duplicate-request protection.

## 🔗 Live Application

- **Frontend:** [EduReach on Vercel](https://edureach-ai-chatbot-bgk.vercel.app/)
- **Backend:** [EduReach API on Render](https://edureach-ai-chatbot.onrender.com/)
- **Health Check:** [GET /api/health](https://edureach-ai-chatbot.onrender.com/api/health)
- **Source Code:** [GitHub Repository](https://github.com/bg-karthik/edureach-ai-chatbot)

## ✨ Features

- **AI Student Guidance:** Ask natural-language questions about admissions, courses, fees, scholarships, placements, and campus facilities.
- **RAG-Powered Chatbot:** Retrieve relevant college information using MongoDB Atlas Vector Search and generate contextual answers with Gemini.
- **Secure Authentication:** Student registration, login, password hashing, and JWT-protected API routes.
- **Private Chat Sessions:** Chat history resets on logout or account changes to prevent cross-account conversation leakage.
- **Voice Counseling Integration:** Request AI-assisted outbound phone calls using Vapi and track call status.
- **Call Safety Controls:** MongoDB-backed call records, idempotency handling, request validation, and concurrency protection.
- **Responsive Interface:** React-based user interface designed for desktop and mobile browsers.
- **Error Handling:** User-friendly messages for Gemini quota limits, AI service failures, and request timeouts.

> **Note:** Outbound telephone calls require a properly configured Vapi account, available credits, and supported phone-number permissions. A successful API integration does not guarantee that live calls can be completed without provider access.

## 🛠️ Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | React.js, TypeScript, Vite, Tailwind CSS, React Router, Axios |
| Backend | Node.js, Express.js, TypeScript |
| Database | MongoDB Atlas, Mongoose |
| AI / RAG | Google Gemini API, LangChain, MongoDB Atlas Vector Search |
| Security | JWT, bcryptjs, protected API routes |
| Voice AI | Vapi Voice AI |
| Hosting | Vercel, Render, MongoDB Atlas |

## 🧠 How the RAG Chatbot Works

```text
Student Question
       |
       v
React Chat Interface
       |
       v
Authenticated Express API
       |
       v
Gemini Text Embeddings
       |
       v
MongoDB Atlas Vector Search
       |
       v
Relevant College Knowledge
       |
       v
Gemini Grounded Response
       |
       v
Answer Displayed to Student
```

### RAG Pipeline

1. **User Input:** A student submits a question through the chatbot interface.
2. **Authentication:** The backend verifies the student's JWT.
3. **Embedding Generation:** The student's question is converted into a vector using Google's embedding model.
4. **Semantic Retrieval:** MongoDB Atlas Vector Search retrieves relevant chunks from the college knowledge base.
5. **Answer Generation:** Gemini generates a response using the retrieved context.
6. **Response Delivery:** The answer is returned to the student's chat interface.
7. **Error Handling:** Provider failures, exhausted quotas, and timeouts are handled using appropriate HTTP responses.

The chatbot generates responses based on the configured knowledge base. Important academic, fee, and placement information should be verified with the relevant institution.

## 📁 Project Structure

```text
edureach-ai-chatbot/
├── client/
│   └── edureach-platform/
│       ├── public/
│       ├── src/
│       │   ├── components/
│       │   ├── context/
│       │   └── services/
│       └── package.json
│
├── server/
│   ├── knowledge-base/
│   │   └── edureach-knowledge.txt
│   ├── src/
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── middleware/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── tests/
│   │   ├── utils/
│   │   ├── app.ts
│   │   └── server.ts
│   └── package.json
│
├── .gitignore
├── README.md
└── vercel.json
```

## 🚀 Getting Started

### Prerequisites

Before running the project, ensure you have:

- Node.js 24 recommended
- npm
- MongoDB Atlas account
- Google Gemini API key
- Configured MongoDB Atlas Vector Search index
- Vapi API credentials (optional, for outbound voice calls)

### 1. Clone the Repository

```bash
git clone https://github.com/bg-karthik/edureach-ai-chatbot.git

cd edureach-ai-chatbot
```

### 2. Backend Setup

Navigate to the backend directory:

```bash
cd server

npm install
```

Create a `.env` file inside the `server` directory.

```env
PORT=5000
NODE_ENV=development

CLIENT_URL=http://localhost:5173

MONGODB_URI=your_mongodb_atlas_connection_string

GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-flash-lite-latest

JWT_SECRET=your_secure_jwt_secret
JWT_EXPIRES_IN=7d

# Optional Vapi Configuration
VAPI_API_KEY=your_vapi_api_key
VAPI_ASSISTANT_ID=your_vapi_assistant_id
VAPI_PHONE_NUMBER_ID=your_vapi_phone_number_id
```

Start the backend:

```bash
npm run dev
```

Backend URL:

```text
http://localhost:5000
```

Health Check:

```text
http://localhost:5000/api/health
```

### 3. Frontend Setup

Open another terminal and navigate to:

```bash
cd client/edureach-platform

npm install
```

Create a `.env` file inside `client/edureach-platform`.

```env
VITE_API_URL=http://localhost:5000/api
```

Start the frontend:

```bash
npm run dev
```

Open the URL displayed by Vite, typically:

```text
http://localhost:5173
```

### 4. MongoDB Atlas Vector Search

The RAG service uses:

| Configuration | Value |
|---|---|
| Database | `edureach_db` |
| Knowledge Collection | `knowledge_docs` |
| Vector Search Index | `edureach_vector_index` |
| Embedding Field | `embedding` |
| Text Field | `text` |
| Embedding Model | `gemini-embedding-001` |
| Vector Dimensions | 3072 |

Configure MongoDB Atlas Vector Search to match the application's embedding model and index settings.

The college knowledge-base source is located at:

```text
server/knowledge-base/edureach-knowledge.txt
```

**Security:** Never upload API keys, JWT secrets, `.env` files, or production database credentials to GitHub.

## 🔌 REST API Endpoints

### Authentication

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/register` | Register a new student |
| POST | `/api/auth/login` | Authenticate a student |
| GET | `/api/auth/me` | Retrieve the authenticated student profile |

### AI Chatbot

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/chat/message` | Submit a student question to the RAG chatbot |

### Vapi Voice Integration

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/vapi/call` | Initiate an outbound AI voice call |
| GET | `/api/vapi/call/:id` | Retrieve voice call status |

### System

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Check backend service health |

Protected endpoints require JWT authentication:

```http
Authorization: Bearer YOUR_JWT_TOKEN
```

### Example Chatbot Request

```bash
curl -X POST http://localhost:5000/api/chat/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"message":"What courses are available?"}'
```

## 🔐 Authentication & Security

EduReach implements:

- JWT-based authentication
- Password hashing using bcryptjs
- Protected API routes
- Account-specific chatbot sessions
- Conversation cleanup on logout
- Cancellation of stale chatbot requests
- Cross-account chat history isolation
- Server-side API key management
- MongoDB-backed voice call tracking
- Atomic controls against duplicate call initiation
- Idempotency safeguards
- Call-record ownership validation

Student chat conversations are not shared through a common browser `localStorage` history key.

Each new login starts a fresh conversation.

## 🎙️ Vapi Voice AI Integration

EduReach includes an outbound voice counseling integration using Vapi.

### Supported Functionality

- Authenticated call initiation
- International phone-number validation
- Vapi assistant integration
- Call status polling
- Persistent MongoDB call records
- Request idempotency
- Duplicate-request prevention
- User-specific call access controls
- Timeout and upstream failure handling

### Voice Integration Flow

```text
Student
   |
   v
Voice Call Request
   |
   v
JWT Authentication
   |
   v
Phone Number Validation
   |
   v
Concurrency & Idempotency Checks
   |
   v
Vapi API
   |
   v
Persistent Call Tracking
   |
   v
Call Status Updates
```

**Important:** Live outbound calls depend on Vapi provider availability, credits, billing configuration, and telephone permissions. Local integration tests use mocked provider interactions.

## 🧪 Testing

The backend includes automated tests for authentication, platform functionality, RAG, account isolation, and voice integration.

Navigate to the backend directory:

```bash
cd server
```

Run all backend tests:

```bash
npm test
```

Run specific test suites:

```bash
npm run test:rag

npm run test:privacy

npm run test:vapi

npm run test:persistent
```

Build the backend:

```bash
npm run build
```

### Frontend Validation

Navigate to:

```bash
cd client/edureach-platform
```

Run the production build:

```bash
npm run build
```

Run frontend linting:

```bash
npm run lint
```

Tests requiring database writes should use an isolated test database instead of production student data.

## ☁️ Deployment

The application uses separate frontend and backend deployments.

### Frontend — Vercel

Production URL:

https://edureach-ai-chatbot-bgk.vercel.app/

Configure:

```env
VITE_API_URL=https://edureach-ai-chatbot.onrender.com/api
```

### Backend — Render

Production URL:

https://edureach-ai-chatbot.onrender.com/

Configure the required backend environment variables securely through Render.

### Database — MongoDB Atlas

The backend connects to MongoDB Atlas for:

- Student accounts
- Authentication-related records
- College knowledge documents
- Vector similarity search
- Persistent Vapi call tracking

### CORS Configuration

The backend should allow requests from the deployed frontend origin:

```env
CLIENT_URL=https://edureach-ai-chatbot-bgk.vercel.app
```

The application requires valid service credentials and available provider quotas.

## ⚠️ Known Limitations

- Gemini API requests are subject to model-specific usage limits and provider availability.
- RAG answer quality depends on the completeness and accuracy of the knowledge base.
- Outbound Vapi calling may require paid credits and supported telephone destinations.
- Chat history is session-based and is not restored after logout.
- Service startup time may vary according to hosting-provider configuration.
- Browser-based speech recognition and text-to-speech are planned enhancements, not part of the currently documented implementation.

## 🔮 Future Enhancements

- Browser-based AI voice counselor using the Web Speech API
- Multilingual student assistance
- Expanded college knowledge base
- Improved RAG evaluation and feedback collection
- Student-specific guidance recommendations
- Administrative knowledge-base management
- Conversation history with secure per-user persistence
- Enhanced accessibility and mobile experience

## 👨‍💻 Developer

**Balina Ganga Karthik**

B.Tech — Computer Science and Engineering (AI & ML)

**GitHub:** [bg-karthik](https://github.com/bg-karthik)

**Repository:** [EduReach AI Chatbot](https://github.com/bg-karthik/edureach-ai-chatbot)

**Live Application:** [EduReach](https://edureach-ai-chatbot-bgk.vercel.app/)

---

⭐ If you find this project useful, consider starring the repository!
