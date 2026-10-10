/**
 * TCONG INFOTECH Premium AI Assistant Widget
 * Features:
 * - Real multi-turn conversation with memory
 * - Clean Markdown formatting (headings, lists, bold, code snippets)
 * - Interactive Lead Capture Form with client validation & email dispatch to info@tcongsinfotech.com
 * - Controls: Minimize, Maximize, New Chat, Close
 * - Enter to send, Shift+Enter for newline
 */

(function () {
  'use strict';

  // State
  let isOpen = false;
  let isMaximized = false;
  let isMinimized = false;
  let isGenerating = false;
  let conversationHistory = []; // { sender: 'user' | 'assistant', text: string }

  const PRIMARY_EMAIL = 'info@tcongsinfotech.com';

  // Escape HTML helper
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Lightweight Markdown to HTML formatter
  function formatMarkdown(text) {
    if (!text) return '';

    // Handle code blocks first
    const codeBlocks = [];
    let formatted = text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, function (_, lang, code) {
      const idx = codeBlocks.length;
      const cleanLang = lang || 'code';
      codeBlocks.push(
        `<div class="tk-code-container"><div class="tk-code-header"><span>${escapeHtml(cleanLang)}</span><button type="button" class="tk-copy-btn" onclick="navigator.clipboard.writeText(this.getAttribute('data-code')).then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',2000)})" data-code="${escapeHtml(code)}">Copy</button></div><pre><code>${escapeHtml(code)}</code></pre></div>`
      );
      return `%%CODE_BLOCK_${idx}%%`;
    });

    // Inline code
    formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Headers
    formatted = formatted.replace(/^### (.*$)/gim, '<h4>$1</h4>');
    formatted = formatted.replace(/^## (.*$)/gim, '<h3>$1</h3>');

    // Bold & italic
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Blockquotes
    formatted = formatted.replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>');

    // Unordered lists
    formatted = formatted.replace(/^\s*[-*]\s+(.*$)/gim, '<li>$1</li>');
    formatted = formatted.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
    // Remove duplicate nested ul tags
    formatted = formatted.replace(/<\/ul>\s*<ul>/g, '');

    // Paragraphs / Linebreaks
    const lines = formatted.split('\n');
    const result = [];
    let inList = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith('<ul>') || line.endsWith('</ul>') || line.startsWith('<li>') || line.startsWith('<h') || line.startsWith('<blockquote') || line.startsWith('%%CODE_BLOCK_')) {
        result.push(line);
      } else {
        result.push(`<p>${line}</p>`);
      }
    }

    formatted = result.join('');

    // Restore code blocks
    for (let i = 0; i < codeBlocks.length; i++) {
      formatted = formatted.replace(`%%CODE_BLOCK_${i}%%`, codeBlocks[i]);
    }

    return formatted;
  }

  // Build DOM Structure
  function initWidget() {
    if (document.getElementById('tk-assistant-root')) return;

    const root = document.createElement('div');
    root.id = 'tk-assistant-root';

    root.innerHTML = `
      <!-- Launcher Button -->
      <button type="button" class="tk-launcher" id="tk-launcher" aria-label="Open TCONG AI Assistant">
        <div class="tk-launcher-avatar">
          <img src="/_next/static/media/tcongs-logo.0svmyiv9nq_lr.png" alt="TCONG INFOTECH" onerror="this.src='/favicon.svg'"/>
          <div class="tk-status-badge"></div>
        </div>
        <div class="tk-launcher-label">
          <span class="tk-launcher-title">Chat with AI</span>
          <span class="tk-launcher-subtitle">TCONG INFOTECH</span>
        </div>
      </button>

      <!-- Chat Window -->
      <div class="tk-chat-container" id="tk-chat-container" role="dialog" aria-labelledby="tk-header-title">
        <!-- Header -->
        <div class="tk-chat-header">
          <div class="tk-header-left">
            <div class="tk-header-avatar">
              <img src="/_next/static/media/tcongs-logo.0svmyiv9nq_lr.png" alt="TCONG INFOTECH Logo" onerror="this.src='/favicon.svg'"/>
              <div class="tk-status-badge"></div>
            </div>
            <div class="tk-header-info">
              <span class="tk-header-title" id="tk-header-title">TCONG AI Assistant</span>
              <span class="tk-header-subtitle">
                <span class="tk-header-pulse"></span>
                Online &bull; Enterprise Tech Support
              </span>
            </div>
          </div>
          <div class="tk-header-actions">
            <button type="button" class="tk-action-btn" id="tk-btn-new-chat" title="New conversation / Clear history" aria-label="New chat">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                <path d="M21 3v5h-5"/>
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
                <path d="M8 16H3v5"/>
              </svg>
            </button>
            <button type="button" class="tk-action-btn" id="tk-btn-maximize" title="Maximize or Restore" aria-label="Maximize window">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 3 21 3 21 9"/>
                <polyline points="9 21 3 21 3 15"/>
                <line x1="21" y1="3" x2="14" y2="10"/>
                <line x1="3" y1="21" x2="10" y2="14"/>
              </svg>
            </button>
            <button type="button" class="tk-action-btn" id="tk-btn-minimize" title="Minimize window" aria-label="Minimize">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
            <button type="button" class="tk-action-btn close" id="tk-btn-close" title="Close chat" aria-label="Close">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Messages Area -->
        <div class="tk-chat-messages" id="tk-chat-messages">
          <!-- Welcome Intro Card -->
          <div class="tk-welcome-card" id="tk-welcome-card">
            <div class="tk-welcome-heading">
              <span>👋</span> Welcome to TCONG INFOTECH
            </div>
            <div class="tk-welcome-body">
              I am your AI Technology Consultant. Ask me about custom software, high-performance web & mobile applications, AI solutions, or request a customized project consultation.
            </div>
            <div class="tk-suggestions">
              <button type="button" class="tk-suggestion-pill" data-prompt="What services do you offer?">
                <span>💡</span> What services do you offer?
              </button>
              <button type="button" class="tk-suggestion-pill" data-prompt="Explain the difference between React and Next.js.">
                <span>⚡</span> Explain React vs. Next.js
              </button>
              <button type="button" class="tk-suggestion-pill" data-prompt="I need custom software for my business operations.">
                <span>🛠️</span> I need custom software
              </button>
              <button type="button" class="tk-suggestion-pill" data-prompt="I would like to request a project quotation and consultation.">
                <span>📋</span> Request a project consultation / quote
              </button>
            </div>
          </div>
        </div>

        <!-- Composer Area -->
        <div class="tk-composer-area">
          <div class="tk-composer-toolbar">
            <button type="button" class="tk-trigger-quote-btn" id="tk-trigger-quote-btn">
              <span>📝</span> Connect with our team / Request quote
            </button>
            <span style="font-size: 11px; color: rgba(255,255,255,0.4);">Enter to send &bull; Shift+Enter newline</span>
          </div>
          <div class="tk-composer-box">
            <textarea 
              class="tk-composer-input" 
              id="tk-composer-input" 
              rows="1" 
              placeholder="Ask anything about our work, tech stack, or quote..."
              aria-label="Your message"></textarea>
            <button type="button" class="tk-send-btn" id="tk-send-btn" aria-label="Send message" disabled>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(root);
    setupEvents();
  }

  // Setup Event Listeners
  function setupEvents() {
    const launcher = document.getElementById('tk-launcher');
    const container = document.getElementById('tk-chat-container');
    const btnClose = document.getElementById('tk-btn-close');
    const btnMinimize = document.getElementById('tk-btn-minimize');
    const btnMaximize = document.getElementById('tk-btn-maximize');
    const btnNewChat = document.getElementById('tk-btn-new-chat');
    const input = document.getElementById('tk-composer-input');
    const btnSend = document.getElementById('tk-send-btn');
    const triggerQuote = document.getElementById('tk-trigger-quote-btn');

    // Toggle chat open
    launcher.addEventListener('click', () => {
      openChat();
    });

    btnClose.addEventListener('click', () => {
      closeChat();
    });

    btnMinimize.addEventListener('click', () => {
      toggleMinimize();
    });

    btnMaximize.addEventListener('click', () => {
      toggleMaximize();
    });

    btnNewChat.addEventListener('click', () => {
      resetConversation();
    });

    triggerQuote.addEventListener('click', () => {
      appendLeadCaptureCard();
    });

    // Auto-expand textarea & enable/disable send button
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      btnSend.disabled = !input.value.trim() || isGenerating;
    });

    // Keyboard handling
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (input.value.trim() && !isGenerating) {
          handleSendMessage();
        }
      } else if (e.key === 'Escape') {
        closeChat();
      }
    });

    btnSend.addEventListener('click', () => {
      if (input.value.trim() && !isGenerating) {
        handleSendMessage();
      }
    });

    // Bind suggestion chips
    document.querySelectorAll('.tk-suggestion-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        const prompt = pill.getAttribute('data-prompt');
        if (prompt) {
          input.value = prompt;
          handleSendMessage();
        }
      });
    });

    // Bind existing website "Let's Talk" buttons across navbar and pages
    document.querySelectorAll('.talk-button, a[href="#talk"], [data-open-chat]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        openChat();
      });
    });
  }

  function openChat() {
    const container = document.getElementById('tk-chat-container');
    const launcher = document.getElementById('tk-launcher');
    isOpen = true;
    isMinimized = false;
    container.classList.remove('minimized');
    container.classList.add('active');
    launcher.style.display = 'none';

    setTimeout(() => {
      const input = document.getElementById('tk-composer-input');
      if (input) input.focus();
    }, 200);
  }

  function closeChat() {
    const container = document.getElementById('tk-chat-container');
    const launcher = document.getElementById('tk-launcher');
    isOpen = false;
    container.classList.remove('active');
    launcher.style.display = 'flex';
  }

  function toggleMinimize() {
    const container = document.getElementById('tk-chat-container');
    isMinimized = !isMinimized;
    if (isMinimized) {
      container.classList.add('minimized');
    } else {
      container.classList.remove('minimized');
    }
  }

  function toggleMaximize() {
    const container = document.getElementById('tk-chat-container');
    isMaximized = !isMaximized;
    if (isMaximized) {
      container.classList.add('maximized');
    } else {
      container.classList.remove('maximized');
    }
    scrollToBottom();
  }

  function resetConversation() {
    conversationHistory = [];
    const messages = document.getElementById('tk-chat-messages');
    const welcomeCard = document.getElementById('tk-welcome-card');

    // Keep only welcome card
    messages.innerHTML = '';
    if (welcomeCard) {
      messages.appendChild(welcomeCard);
    } else {
      messages.innerHTML = `
        <div class="tk-welcome-card" id="tk-welcome-card">
          <div class="tk-welcome-heading"><span>👋</span> Welcome to TCONG INFOTECH</div>
          <div class="tk-welcome-body">
            Conversation reset. Ask me about custom software, web & mobile applications, AI integration, or project consultations!
          </div>
        </div>
      `;
    }

    appendAssistantMessage('Conversation cleared. How can I help you today?');
  }

  function scrollToBottom() {
    const messages = document.getElementById('tk-chat-messages');
    if (!messages) return;
    messages.scrollTop = messages.scrollHeight;
  }

  function appendUserMessage(text) {
    const messages = document.getElementById('tk-chat-messages');
    const row = document.createElement('div');
    row.className = 'tk-msg-row user';
    row.innerHTML = `<div class="tk-msg-bubble">${escapeHtml(text)}</div>`;
    messages.appendChild(row);
    scrollToBottom();
  }

  function appendAssistantMessage(text) {
    const messages = document.getElementById('tk-chat-messages');
    const row = document.createElement('div');
    row.className = 'tk-msg-row assistant';
    row.innerHTML = `<div class="tk-msg-bubble">${formatMarkdown(text)}</div>`;
    messages.appendChild(row);
    scrollToBottom();
  }

  function showTypingIndicator() {
    const messages = document.getElementById('tk-chat-messages');
    const indicator = document.createElement('div');
    indicator.className = 'tk-msg-row assistant';
    indicator.id = 'tk-typing-indicator';
    indicator.innerHTML = `
      <div class="tk-msg-bubble tk-typing">
        <span class="tk-typing-dot"></span>
        <span class="tk-typing-dot"></span>
        <span class="tk-typing-dot"></span>
        <span style="font-size: 11.5px; margin-left: 6px; color: rgba(255,255,255,0.65);">TCONG AI is thinking...</span>
      </div>
    `;
    messages.appendChild(indicator);
    scrollToBottom();
  }

  function hideTypingIndicator() {
    const indicator = document.getElementById('tk-typing-indicator');
    if (indicator) indicator.remove();
  }

  // Interactive Lead Capture Card
  function appendLeadCaptureCard() {
    // Avoid appending duplicates if one is already open and not submitted
    if (document.getElementById('tk-active-lead-form')) return;

    const messages = document.getElementById('tk-chat-messages');
    const row = document.createElement('div');
    row.className = 'tk-msg-row assistant';
    row.innerHTML = `
      <div class="tk-msg-bubble" style="max-width: 95%;">
        <div class="tk-lead-card" id="tk-active-lead-form">
          <div class="tk-lead-title">
            <span>📋</span> Connect with TCONG INFOTECH Team
          </div>
          <div class="tk-lead-desc">
            Share your project requirements and our technical solutions team will review and contact you with a tailored consultation proposal.
          </div>
          <form id="tk-lead-form">
            <div class="tk-form-group">
              <label class="tk-form-label">Full Name</label>
              <input type="text" class="tk-form-input" id="tk-lead-name" placeholder="Your name (optional)"/>
            </div>
            <div class="tk-form-group">
              <label class="tk-form-label">Email Address <span class="req">*</span></label>
              <input type="email" class="tk-form-input" id="tk-lead-email" placeholder="name@company.com" required/>
            </div>
            <div class="tk-form-group">
              <label class="tk-form-label">Phone Number <span class="req">*</span></label>
              <input type="tel" class="tk-form-input" id="tk-lead-phone" placeholder="+1 (555) 000-0000" required/>
            </div>
            <div class="tk-form-group">
              <label class="tk-form-label">Service of Interest</label>
              <select class="tk-form-select" id="tk-lead-service">
                <option value="Custom Software Development">Custom Software Development</option>
                <option value="Web Application Development">Web Application Development</option>
                <option value="Mobile App Development (iOS/Android)">Mobile App Development</option>
                <option value="UI/UX Design & Prototyping">UI/UX Design & Prototyping</option>
                <option value="Cloud Solutions & DevOps">Cloud Solutions & DevOps</option>
                <option value="AI & Machine Learning Solutions">AI & Machine Learning</option>
                <option value="General Consultation">General Technical Consultation</option>
              </select>
            </div>
            <div class="tk-form-group">
              <label class="tk-form-label">Project Details / Requirements</label>
              <textarea class="tk-form-textarea" id="tk-lead-req" placeholder="Briefly describe your goals, timeline, or features..."></textarea>
            </div>
            <div id="tk-lead-error" style="color: #f87171; font-size: 11.5px; margin-bottom: 6px; display: none;"></div>
            <button type="submit" class="tk-lead-submit-btn" id="tk-lead-submit">
              <span>🚀</span> Submit &amp; Connect with Team
            </button>
          </form>
        </div>
      </div>
    `;

    messages.appendChild(row);
    scrollToBottom();

    // Form submission listener
    const form = document.getElementById('tk-lead-form');
    const submitBtn = document.getElementById('tk-lead-submit');
    const errorBox = document.getElementById('tk-lead-error');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.style.display = 'none';

      const name = document.getElementById('tk-lead-name').value.trim();
      const email = document.getElementById('tk-lead-email').value.trim();
      const phone = document.getElementById('tk-lead-phone').value.trim();
      const service = document.getElementById('tk-lead-service').value;
      const message = document.getElementById('tk-lead-req').value.trim();

      // Client validation
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errorBox.textContent = 'Please enter a valid email address.';
        errorBox.style.display = 'block';
        return;
      }

      const digits = phone.replace(/\D/g, '');
      if (!phone || digits.length < 7) {
        errorBox.textContent = 'Please enter a valid phone number (at least 7 digits).';
        errorBox.style.display = 'block';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>⏳</span> Sending details to team...';

      try {
        const res = await fetch('/api/leads/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            email,
            phone,
            service,
            message,
            source: 'AI Assistant Interactive Form',
          }),
        });

        const data = await res.json();

        if (res.ok && data.success) {
          const card = document.getElementById('tk-active-lead-form');
          card.innerHTML = `
            <div class="tk-lead-success">
              <div style="font-size: 18px; margin-bottom: 4px;">✅</div>
              <strong style="color: #ffffff; font-size: 13.5px; display: block; margin-bottom: 4px;">Request Received Successfully!</strong>
              Your details have been securely dispatched directly to our technical consulting team at <strong>${PRIMARY_EMAIL}</strong>.<br/>
              A specialist will review your project and get in touch with you shortly.
            </div>
          `;
          conversationHistory.push({
            sender: 'user',
            text: `[Submitted Contact Form: Email=${email}, Phone=${phone}, Service=${service}]`,
          });
          conversationHistory.push({
            sender: 'assistant',
            text: `Thank you! Your information has been securely sent to our team at ${PRIMARY_EMAIL}. We will follow up with you promptly.`,
          });
        } else {
          errorBox.textContent = data.error || 'Submission failed. Please try again.';
          errorBox.style.display = 'block';
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>🚀</span> Submit &amp; Connect with Team';
        }
      } catch (err) {
        console.error('Lead submission error:', err);
        errorBox.textContent = 'Connection error. Please try again or email us directly at ' + PRIMARY_EMAIL;
        errorBox.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>🚀</span> Submit &amp; Connect with Team';
      }
    });
  }

  // Handle Send Message
  async function handleSendMessage() {
    const input = document.getElementById('tk-composer-input');
    const sendBtn = document.getElementById('tk-send-btn');
    const text = input.value.trim();

    if (!text || isGenerating) return;

    // Reset input
    input.value = '';
    input.style.height = 'auto';
    sendBtn.disabled = true;

    // Append to UI and history
    appendUserMessage(text);
    conversationHistory.push({ sender: 'user', text });

    // Show typing
    isGenerating = true;
    showTypingIndicator();

    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: conversationHistory.slice(-10),
        }),
      });

      const data = await res.json();
      hideTypingIndicator();

      const reply = data.reply || `At TCONG INFOTECH, we build custom software that fits your business. Contact our team at ${PRIMARY_EMAIL}.`;
      appendAssistantMessage(reply);
      conversationHistory.push({ sender: 'assistant', text: reply });

      // Suggest interactive lead form if appropriate
      if (data.suggestLeadForm) {
        setTimeout(() => {
          appendLeadCaptureCard();
        }, 400);
      }
    } catch (err) {
      console.error('AI chat error:', err);
      hideTypingIndicator();
      const fallbackMsg = `I apologize, but I encountered a connection issue. However, our team at **TCONG INFOTECH** is always ready to assist you. You can reach out directly to **${PRIMARY_EMAIL}** or use the contact button below.`;
      appendAssistantMessage(fallbackMsg);
      appendLeadCaptureCard();
    } finally {
      isGenerating = false;
      sendBtn.disabled = !input.value.trim();
    }
  }

  // Self-initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWidget);
  } else {
    initWidget();
  }
})();
