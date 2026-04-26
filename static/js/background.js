chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create({
    url: 'static/index.html'
  });
});
