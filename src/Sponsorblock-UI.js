const sponsorBlockIcon = 'https://raw.githubusercontent.com/last-wave/youtube-webos/refs/heads/main/src/icons/IconSponsorBlocker64px.png';

const STYLES = `
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;600;700&family=Noto+Sans+Mono:wght@400;500;600;700&display=swap');
    
    /* --- Popup Styles --- */
    .sb-segments-popup {
        position: fixed;
        top: 5%;
        right: 4%;
        bottom: auto;
        left: auto;
        transform: none;
        
        background-color: #000000;
        border: 0.4vh solid rgba(52, 52, 52, 0.4);
        border-radius: 1.6vh;
        padding: 1.04vw;          /* 20px */
        
        width: 44vw;
        max-height: 90vh;
        overflow-y: auto;
        
        z-index: 9999;
        display: none;
        color: #ececec;
        font-family: 'Noto Sans', 'YouTube Noto', Roboto, sans-serif;
        box-shadow: 0 0.8vh 1.6vh rgba(0, 0, 0, 0.8);
    }
    
    .sb-segments-popup.visible {
        display: block;
    }

    .sb-popup-header {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding-bottom: 1.38vh;   /* 15px */
        margin-bottom: 1.38vh;    /* 15px */
        border-bottom: 0.2vw solid rgba(255,255,255,0.2);
        text-align: center;
    }

    .sb-header-title-row {
        display: flex;
        align-items: center;
        margin-bottom: 0.46vh;    /* 5px */
    }

    .sb-header-icon {
        width: 1.67vw;            /* 32px */
        height: 1.67vw;           /* 32px - Kept square using vw */
        fill: #ff0000;
        margin-right: 0.52vw;     /* 10px */
    }

    .sb-header-text {
        font-size: 2.2vw;         /* 48px */
        font-weight: 600;
        color: #ececec;
    }

    .sb-segment-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.93vh 0.63vw;   /* 10px 12px */
        border-radius: 0.3vw;    /* 6px */
        margin-bottom: 0.28vh;    /* 3px */
        background: transparent;
        transition: background-color 0.2s;
    }

    .sb-row-left {
        display: flex;
        align-items: center;
    }

    .sb-segment-dot {
        width: 0.52vw;            /* 10px */
        height: 0.52vw;           /* 10px - Kept square using vw */
        border-radius: 50%;
        flex-shrink: 0;
        margin-right: 0.63vw;     /* 12px */
    }

    .sb-segment-category {
        font-weight: 500;
        font-size: 1.47vw;        /* 28px */
        color: #f0f0f0;
    }

    .sb-segment-time {
        font-size: 1.47vw;        /* 28px */
        font-family: 'Noto Sans Mono', 'Roboto Mono', monospace;
        color: #ececec;
        font-weight: 500;
    }

    .sb-segments-popup:focus {
        outline: none;
        border-color: #fff;
    }

    .sb-segment-row:focus {
        background-color: #fff;
        outline: none;
    }
    
    .sb-segment-row:focus .sb-segment-category,
    .sb-segment-row:focus .sb-segment-time {
        color: #000;
    }
`;

class SponsorBlockUI {
  constructor() {
    this.popup = null;
    this.visible = false;
    this.hasSegments = false;
    this.injectStyles();
  }

  injectStyles() {
    if (!document.getElementById('sb-ui-styles')) {
      const style = document.createElement('style');
      style.id = 'sb-ui-styles';
      style.textContent = STYLES;
      document.head.appendChild(style);
    }
  }

  formatTime(seconds) {
    const date = new Date(0);
    date.setSeconds(seconds);
    const timeStr = date.toISOString().substr(11, 8);
    return timeStr.startsWith('00:') ? timeStr.slice(3) : timeStr;
  }

  getSegmentColor(category) {
    const colors = {
      sponsor: '#00d400',
      intro: '#00ffff',
      outro: '#0202ed',
      interaction: '#cc00ff',
      selfpromo: '#ffff00',
      music_offtopic: '#ff9900',
      preview: '#008fd6',
      poi: '#ff1684',
      filler: '#7300FF',
      poi_highlight: '#ff1684',
      hook: '#395699'
    };
    return colors[category] || '#777';
  }

  getCategoryName(category) {
    const names = {
      sponsor: 'Sponsor',
      intro: 'Intermission/Intro',
      outro: 'Endcards/Credits',
      interaction: 'Interaction',
      selfpromo: 'Unpaid/Self Promotion',
      music_offtopic: 'Non-Music Section',
      preview: 'Preview/Recap',
      poi: 'Highlight',
      poi_highlight: 'Highlight',
      filler: 'Filler/Tangents'
    };
    return names[category] || category.charAt(0).toUpperCase() + category.slice(1);
  }

  createPopup() {
    if (this.popup) return this.popup;

    const popup = document.createElement('div');
    popup.className = 'sb-segments-popup';
    popup.setAttribute('tabindex', '-1');

    const header = document.createElement('div');
    header.className = 'sb-popup-header';

    const titleRow = document.createElement('div');
    titleRow.className = 'sb-header-title-row';

    const icon = document.createElement('img');
    icon.className = 'sb-header-icon';
    icon.src = sponsorBlockIcon;
    icon.alt = 'SponsorBlock';

    const titleText = document.createElement('span');
    titleText.className = 'sb-header-text';
    titleText.textContent = 'SponsorBlock';
    titleRow.appendChild(icon);
    titleRow.appendChild(titleText);
    header.appendChild(titleRow);

    const listContainer = document.createElement('div');
    listContainer.className = 'sb-list-container';

    popup.appendChild(header);
    popup.appendChild(listContainer);
    document.body.appendChild(popup);
    this.popup = popup;

    return popup;
  }

  updateSegments(segments) {
    if (!this.popup) this.createPopup();
    const container = this.popup.querySelector('.sb-list-container');
    container.textContent = '';

    this.hasSegments = segments && segments.length > 0;
    if (!this.hasSegments) {
      this.popup.classList.remove('visible');
      return;
    }

    // Sort segments chronologically by start time
    const sortedSegments = [...segments].sort((a, b) => a.segment[0] - b.segment[0]);

    sortedSegments.forEach(segment => {
      const row = document.createElement('div');
      row.className = 'sb-segment-row';
      row.setAttribute('tabindex', '-1');

      const color = this.getSegmentColor(segment.category);
      const startTime = this.formatTime(segment.segment[0]);
      const endTime = this.formatTime(segment.segment[1]);
      const categoryName = this.getCategoryName(segment.category);

      // Handle Highlights specifically (single timestamp vs range)
      let timeLabel;
      if (segment.category === 'poi_highlight' || segment.category === 'poi') {
        timeLabel = startTime;
      } else {
        timeLabel = `${startTime} to ${endTime}`;
      }

      const leftRow = document.createElement('div');
      leftRow.className = 'sb-row-left';

      const dot = document.createElement('div');
      dot.className = 'sb-segment-dot';
      dot.style.backgroundColor = color;

      const categorySpan = document.createElement('span');
      categorySpan.className = 'sb-segment-category';
      categorySpan.textContent = categoryName;

      leftRow.appendChild(dot);
      leftRow.appendChild(categorySpan);

      const timeSpan = document.createElement('span');
      timeSpan.className = 'sb-segment-time';
      timeSpan.textContent = timeLabel;

      row.appendChild(leftRow);
      row.appendChild(timeSpan);

      container.appendChild(row);
    });
    if (this.visible) {
      this.popup.classList.add('visible');
    }
  }

  togglePopup(visible) {
    if (!this.popup) this.createPopup();
    this.visible = visible;

    if (this.visible && this.hasSegments) {
      this.popup.classList.add('visible');
    } else {
      this.popup.classList.remove('visible');
    }
  }
}

export default new SponsorBlockUI();
