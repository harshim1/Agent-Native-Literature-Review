
## Features

- 🔍 **Intelligent Search** - Search academic topics and get comprehensive research landscape analysis
- 📈 **Publication Trends** - Visualize research trends over time with interactive charts
- 🤖 **AI-Powered Insights** - Get AI-generated summaries and research recommendations
- 💡 **Proposal Generator** - Generate NSF grant proposal drafts automatically
- 🔗 **Collaboration Finder** - Discover potential research collaborators
- 💾 **Save & Compare** - Save papers and compare research across multiple topics

## Technology Stack

- **Frontend**: React 19 with TypeScript
- **Styling**: Tailwind CSS v4.2
- **Build Tool**: Vite
- **UI Components**: Recharts for data visualization
- **Font**: Inter (Google Fonts)

## Design Features

- **Purple Theme** - Modern gradient backgrounds with purple and indigo accents
- **Responsive Layout** - Fully responsive design that works on all devices
- **Professional Typography** - Inter font with optimized sizing and spacing
- **Large UI Components** - Spacious layout with generous padding and touch-friendly buttons
- **Clean Interface** - Minimal design focusing on content and usability

## Getting Started

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Installation
![Screenshot](images/Screenshot 2026-02-27 at 6.13.32 PM.heic)
![Screenshot](images/Screenshot 2026-02-27 at 8.19.57 PM.heic)
```bash
cd litreview
npm install

Development
Run the development server:

npm run dev

The application will be available at http://localhost:5173

Build
Build for production:

npm run build

The built files will be in the dist/ directory.

Project Structure
litreview/
├── src/
│   ├── App.tsx          # Main application component
│   ├── main.tsx         # React entry point
│   ├── index.css        # Global styles and Tailwind configuration
│   └── assets/          # Images and static assets
├── index.html           # HTML template
├── tailwind.config.js   # Tailwind CSS configuration
├── vite.config.js       # Vite configuration
└── package.json         # Project dependencies

Configuration
Tailwind CSS
The project uses Tailwind CSS v4 with a custom configuration in tailwind.config.js. All color utilities are defined in src/index.css using the @layer utilities directive.

Environment Variables
Create a .env file in the root directory for API keys and configuration:

VITE_GROQ_KEY=your_groq_api_key_here

Features Implemented
✅ Responsive grid layouts
✅ Publication trend charts and graphs
✅ Research gap analysis
✅ Paper comparison functionality
✅ Search history tracking
✅ AI-powered summaries
✅ NSF proposal generator

Browser Support
Chrome/Edge (latest)
Firefox (latest)
Safari (latest)
Performance
Optimized bundle size: ~589KB (minified)
Fast development server with Vite
Efficient CSS with Tailwind utility classes
Responsive images and lazy loading

Contributing
When making changes:

Keep the purple theme consistent
Use Tailwind CSS classes for styling
Maintain responsive design principles
Follow the existing code structure
License
This project is part of the Agent-Native Literature Review system.

Support
For issues or questions, please refer to the project documentation or create an issue in the repository.

Last Updated: February 2026
Current Version: 1.0.0
Status: Active Development
