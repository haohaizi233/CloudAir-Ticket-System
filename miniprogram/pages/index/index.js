Page({
  data: {
    fromCity: '北京',
    toCity: '上海',
    date: '',
    today: '',
    keyword: '',
    hotCities: ['北京', '上海', '广州', '深圳', '成都', '杭州', '西安', '三亚', '昆明', '重庆'],
    allCities: ['北京', '上海', '广州', '深圳', '成都', '杭州', '西安', '三亚', '昆明', '重庆', '南京', '武汉', '长沙', '郑州', '青岛', '大连', '厦门', '珠海', '海口', '贵阳', '兰州', '太原', '合肥', '福州', '南宁', '乌鲁木齐', '拉萨', '呼和浩特', '哈尔滨', '长春', '沈阳', '天津', '石家庄', '济南', '南昌', '银川', '西宁'],
    citySuggestions: [],
    showSuggestions: false,
    hotRoutes: [
      { from: '北京', to: '上海' },
      { from: '成都', to: '三亚' },
      { from: '广州', to: '昆明' },
      { from: '深圳', to: '杭州' },
      { from: '上海', to: '成都' },
      { from: '北京', to: '广州' }
    ],
    cityTarget: '',
    searchHistory: [],
    favoriteSearches: [],
    recommendedRoutes: [],
    historyGroups: [],
    searching: false,
    swapRotated: false,
    showGuide: false,
    guideAnimation: {},
    isOnline: true,
    banners: [
      {
        id: 1,
        url: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=airplane%20flying%20above%20clouds%20blue%20sky%20travel%20poster&image_size=landscape_16_9',
        title: '云端之旅',
        from: '北京',
        to: '三亚'
      },
      {
        id: 2,
        url: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=modern%20city%20skyline%20sunset%20travel%20poster&image_size=landscape_16_9',
        title: '繁华都市',
        from: '成都',
        to: '上海'
      },
      {
        id: 3,
        url: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=tropical%20island%20beach%20palm%20trees%20travel%20poster&image_size=landscape_16_9',
        title: '海岛度假',
        from: '上海',
        to: '昆明'
      }
    ],
    notices: [
      '温馨提示：请提前2小时到达机场办理登机手续',
      '航班动态：北京-上海航线新增每日3班',
      '安全提示：请勿携带违禁物品登机',
      '服务升级：在线选座功能已全面开放',
      '优惠活动：新用户首单立减50元'
    ],
    userInfo: null,
    nickName: '旅行者',
    avatarUrl: ''
  },

  // 1. 监听出发地输入
  onInputFrom(e) {
    const value = e.detail.value
    this.setData({ fromCity: value })
    this.updateCitySuggestions(value)
  },

  onLoad() {
    // 检查网络状态
    const app = getApp()
    this.setData({ isOnline: app.globalData.isOnline })
    wx.onNetworkStatusChange((res) => {
      this.setData({ isOnline: res.isConnected })
    })

    // 加载用户信息
    const savedUser = wx.getStorageSync('userInfo')
    if (savedUser) {
      this.setData({
        userInfo: savedUser,
        nickName: savedUser.nickName || '旅行者',
        avatarUrl: savedUser.avatarUrl || ''
      })
    }

    const now = new Date()
    const formatDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const today = formatDate(now)
    const tomorrow = formatDate(new Date(now.getTime() + 86400000))
    const dayAfter = formatDate(new Date(now.getTime() + 86400000 * 2))
    const searchHistory = wx.getStorageSync('searchHistory') || []
    const favoriteSearches = wx.getStorageSync('favoriteSearches') || []
    // 恢复上次搜索条件
    const lastSearch = wx.getStorageSync('lastSearchCondition') || {}
    // 生成搜索历史分组和推荐
    const historyGroups = this.buildHistoryGroups(searchHistory)
    const recommendedRoutes = this.buildRecommendedRoutes(searchHistory)
    this.setData({
      today, tomorrow, dayAfter, searchHistory, favoriteSearches,
      historyGroups, recommendedRoutes,
      fromCity: lastSearch.fromCity || '北京',
      toCity: lastSearch.toCity || '上海',
      date: lastSearch.date || today,
      keyword: lastSearch.keyword || ''
    })
    // 新手引导
    const hasVisited = wx.getStorageSync('hasVisited')
    if (!hasVisited) {
      this.setData({ showGuide: true })
      this.playGuideAnimation()
    }
  },

  // 2. 监听目的地输入
  onInputTo(e) {
    const value = e.detail.value
    this.setData({ toCity: value })
    this.updateCitySuggestions(value)
  },

  // 点击出发地输入框，标记城市选择目标
  onFocusFrom() {
    this.setData({ cityTarget: 'from' })
  },

  // 点击目的地输入框，标记城市选择目标
  onFocusTo() {
    this.setData({ cityTarget: 'to' })
  },

  // 关键词输入框聚焦也展开热门城市
  onFocusKeyword() {
    this.setData({ cityTarget: this.data.cityTarget || 'from' })
  },

  // 选择热门城市
  onSelectCity(e) {
    const city = e.currentTarget.dataset.city
    if (this.data.cityTarget === 'from') {
      this.setData({ fromCity: city, cityTarget: '', showSuggestions: false, citySuggestions: [] })
    } else {
      this.setData({ toCity: city, cityTarget: '', showSuggestions: false, citySuggestions: [] })
    }
  },

  // 城市智能提示
  updateCitySuggestions(input) {
    if (!input || input.length === 0) {
      this.setData({ citySuggestions: [], showSuggestions: false })
      return
    }
    const suggestions = this.data.allCities.filter(city => city.includes(input))
    this.setData({ citySuggestions: suggestions.slice(0, 6), showSuggestions: suggestions.length > 0 })
  },

  // 选择建议城市
  onSelectSuggestion(e) {
    const city = e.currentTarget.dataset.city
    if (this.data.cityTarget === 'from') {
      this.setData({ fromCity: city, showSuggestions: false, citySuggestions: [] })
    } else {
      this.setData({ toCity: city, showSuggestions: false, citySuggestions: [] })
    }
  },

  // 3. 监听日期选择
  onDateChange(e) {
    this.setData({ date: e.detail.value })
  },

  // 4. ▼▼▼ 新增：监听关键词输入 ▼▼▼
  onInputKeyword(e) {
    this.setData({ keyword: e.detail.value })
  },

  onClearDate() {
    this.setData({ date: '' })
  },

  onClearKeyword() {
    this.setData({ keyword: '' })
  },

  // 快捷选择日期
  onQuickDate(e) {
    const date = e.currentTarget.dataset.date
    this.setData({ date })
  },

  // 一键清空搜索条件
  onResetSearch() {
    this.setData({ fromCity: '', toCity: '', date: '', keyword: '', cityTarget: '' })
  },
  
  // 交换出发地和目的地
  onSwapCity() {
    const { fromCity, toCity } = this.data
    this.setData({ 
      fromCity: toCity, 
      toCity: fromCity,
      swapRotated: !this.data.swapRotated
    })
  },

  // 5. 点击搜索按钮
  onSearch() {
    // 防止重复点击
    if (this._searching) return
    const { fromCity, toCity, date, keyword } = this.data
    if (fromCity && toCity && fromCity === toCity) {
      wx.showToast({ title: '出发地和目的地不能相同', icon: 'none' })
      return
    }
    const hasCondition = fromCity || toCity || date || keyword
    if (!hasCondition) {
      wx.showModal({
        title: '搜索提示',
        content: '您未填写任何搜索条件，将查询所有航班。建议至少输入出发地或目的地以缩小范围。',
        confirmText: '查看全部',
        cancelText: '去填写',
        success: (res) => {
          if (res.confirm) {
            this._doSearch(fromCity, toCity, date, keyword)
          }
        }
      })
      return
    }
    this._doSearch(fromCity, toCity, date, keyword)
  },

  _doSearch(fromCity, toCity, date, keyword) {
    if (this._searching) return
    this._searching = true
    this.setData({ searching: true })
    const url = `/pages/flight-list/index?from=${encodeURIComponent(fromCity)}&to=${encodeURIComponent(toCity)}&date=${date}&keyword=${encodeURIComponent(keyword)}`
    // 轻量保存搜索历史（只写存储，不刷新UI，避免阻塞导航）
    this.saveSearchHistory({ fromCity, toCity, date, keyword }, true)
    wx.setStorageSync('lastSearchCondition', { fromCity, toCity, date, keyword })
    wx.navigateTo({
      url: url,
      fail: (err) => {
        console.error('跳转失败', err)
        wx.showModal({
          title: '提示',
          content: '页面跳转失败，请重试',
          showCancel: false
        })
      },
      complete: () => {
        this._searching = false
        this.setData({ searching: false })
      }
    })
  },

  // 页面重新显示时刷新数据
  onShow() {
    const searchHistory = wx.getStorageSync('searchHistory') || []
    const favoriteSearches = wx.getStorageSync('favoriteSearches') || []
    const historyGroups = this.buildHistoryGroups(searchHistory)
    const recommendedRoutes = this.buildRecommendedRoutes(searchHistory)
    this.setData({ searchHistory, favoriteSearches, historyGroups, recommendedRoutes })
    // 重置搜索锁定状态
    this._searching = false
    this.setData({ searching: false })
  },

  // 保存搜索历史（增强版：记录时间戳和搜索次数）
  // lightweight=true时只写存储不刷新UI（搜索跳转时使用，避免阻塞）
  saveSearchHistory(record, lightweight) {
    const label = `${record.fromCity || '任意'} → ${record.toCity || '任意'}`
    let history = wx.getStorageSync('searchHistory') || []
    const now = new Date()
    const timestamp = now.getTime()
    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    // 查找是否已有相同航线
    const existIndex = history.findIndex(item => item.label === label)
    if (existIndex >= 0) {
      const existing = history[existIndex]
      existing.searchCount = (existing.searchCount || 0) + 1
      existing.lastSearchTime = timeStr
      existing.timestamp = timestamp
      existing.date = record.date || existing.date
      existing.keyword = record.keyword || existing.keyword
      // 移到最前面
      history.splice(existIndex, 1)
      history.unshift(existing)
    } else {
      history.unshift({
        label,
        fromCity: record.fromCity || '',
        toCity: record.toCity || '',
        date: record.date || '',
        keyword: record.keyword || '',
        searchDate: record.date || '日期不限',
        searchCount: 1,
        lastSearchTime: timeStr,
        timestamp
      })
    }
    // 最多保留20条
    if (history.length > 20) history = history.slice(0, 20)
    wx.setStorageSync('searchHistory', history)
    // 轻量模式只写存储，不刷新UI（搜索跳转时由onShow刷新）
    if (!lightweight) {
      const historyGroups = this.buildHistoryGroups(history)
      const recommendedRoutes = this.buildRecommendedRoutes(history)
      this.setData({ searchHistory: history, historyGroups, recommendedRoutes })
    }
  },

  // 点击搜索历史 - 填入条件并直接搜索
  onTapHistory(e) {
    const record = e.currentTarget.dataset.record
    this.setData({
      fromCity: record.fromCity || '',
      toCity: record.toCity || '',
      date: record.date || '',
      keyword: record.keyword || ''
    })
    // 直接触发搜索
    this.onSearch()
  },

  // 清空搜索历史
  onClearHistory() {
    wx.showModal({
      title: '提示',
      content: '确定清空搜索历史吗？',
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync('searchHistory')
          this.setData({ searchHistory: [], historyGroups: [], recommendedRoutes: [] })
        }
      }
    })
  },

  // 删除单条搜索历史
  onDeleteHistory(e) {
    const index = e.currentTarget.dataset.index
    let history = this.data.searchHistory
    history.splice(index, 1)
    wx.setStorageSync('searchHistory', history)
    const historyGroups = this.buildHistoryGroups(history)
    const recommendedRoutes = this.buildRecommendedRoutes(history)
    this.setData({ searchHistory: history, historyGroups, recommendedRoutes })
  },

  // 收藏搜索条件
  onToggleFavoriteSearch(e) {
    const record = e.currentTarget.dataset.record
    let favorites = wx.getStorageSync('favoriteSearches') || []
    const existIndex = favorites.findIndex(f => f.label === record.label)
    if (existIndex >= 0) {
      favorites.splice(existIndex, 1)
      wx.showToast({ title: '已取消收藏', icon: 'none', duration: 800 })
    } else {
      favorites.unshift({
        label: record.label,
        fromCity: record.fromCity,
        toCity: record.toCity,
        date: record.date || '',
        keyword: record.keyword || ''
      })
      wx.showToast({ title: '已收藏', icon: 'none', duration: 800 })
    }
    wx.setStorageSync('favoriteSearches', favorites)
    const historyGroups = this.buildHistoryGroups(this.data.searchHistory)
    this.setData({ favoriteSearches: favorites, historyGroups })
  },

  // 点击收藏的搜索条件
  onTapFavoriteSearch(e) {
    const record = e.currentTarget.dataset.record
    this.setData({
      fromCity: record.fromCity || '',
      toCity: record.toCity || '',
      date: record.date || '',
      keyword: record.keyword || ''
    })
    this.onSearch()
  },

  // 删除收藏的搜索条件
  onDeleteFavoriteSearch(e) {
    const index = e.currentTarget.dataset.index
    let favorites = this.data.favoriteSearches
    favorites.splice(index, 1)
    wx.setStorageSync('favoriteSearches', favorites)
    this.setData({ favoriteSearches: favorites })
  },

  // 构建搜索历史分组（今天/昨天/更早）
  buildHistoryGroups(history) {
    if (!history || history.length === 0) return []
    const favorites = this.data ? this.data.favoriteSearches : (wx.getStorageSync('favoriteSearches') || [])
    const favLabels = favorites.map(f => f.label)
    const now = new Date()
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const yesterday = new Date(now.getTime() - 86400000)
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`
    const groups = { today: [], yesterday: [], earlier: [] }
    history.forEach((item, index) => {
      const itemWithIndex = { ...item, originalIndex: index, isFavSearch: favLabels.indexOf(item.label) >= 0 }
      if (item.lastSearchTime) {
        const datePart = item.lastSearchTime.split(' ')[0]
        if (datePart === todayStr) {
          groups.today.push(itemWithIndex)
        } else if (datePart === yesterdayStr) {
          groups.yesterday.push(itemWithIndex)
        } else {
          groups.earlier.push(itemWithIndex)
        }
      } else {
        groups.earlier.push(itemWithIndex)
      }
    })
    const result = []
    if (groups.today.length > 0) result.push({ groupLabel: '今天', items: groups.today })
    if (groups.yesterday.length > 0) result.push({ groupLabel: '昨天', items: groups.yesterday })
    if (groups.earlier.length > 0) result.push({ groupLabel: '更早', items: groups.earlier })
    return result
  },

  // 基于搜索频率构建推荐航线
  buildRecommendedRoutes(history) {
    if (!history || history.length === 0) return []
    // 按搜索次数排序，取前3个
    const sorted = [...history].sort((a, b) => (b.searchCount || 1) - (a.searchCount || 1))
    return sorted.slice(0, 3).map(item => ({
      label: item.label,
      fromCity: item.fromCity,
      toCity: item.toCity,
      searchCount: item.searchCount || 1
    }))
  },

  // 分享给好友
  onShareAppMessage() {
    return {
      title: '云端航空 - 机票预订',
      path: '/pages/index/index'
    }
  },

  // 点击热门航线快捷标签
  onQuickRoute(e) {
    const { from, to } = e.currentTarget.dataset
    this.setData({
      fromCity: from,
      toCity: to,
      cityTarget: '',
      date: this.data.date || this.data.tomorrow
    })
    this.onSearch()
  },

  // 新手引导动画
  playGuideAnimation() {
    const animation = wx.createAnimation({
      duration: 500,
      timingFunction: 'ease-out'
    })
    animation.opacity(1).translateY(0).step()
    this.setData({ guideAnimation: animation.export() })
  },

  // 关闭新手引导
  onCloseGuide() {
    const animation = wx.createAnimation({
      duration: 300,
      timingFunction: 'ease-in'
    })
    animation.opacity(0).translateY(-20).step()
    this.setData({ guideAnimation: animation.export() })
    setTimeout(() => {
      this.setData({ showGuide: false })
      wx.setStorageSync('hasVisited', true)
    }, 300)
  },

  // 获取用户信息
  onGetUserProfile() {
    wx.getUserProfile({
      desc: '用于完善用户资料',
      success: (res) => {
        const userInfo = res.userInfo
        this.setData({
          userInfo,
          nickName: userInfo.nickName || '旅行者',
          avatarUrl: userInfo.avatarUrl || ''
        })
        wx.setStorageSync('userInfo', {
          nickName: userInfo.nickName,
          avatarUrl: userInfo.avatarUrl
        })
      },
      fail: () => {
        wx.showToast({ title: '未授权获取头像', icon: 'none' })
      }
    })
  },

  // 跳转个人中心
  onGoProfile() {
    wx.switchTab({ url: '/pages/profile/index' })
  },

  // 头像加载失败时回退到默认
  onAvatarError() {
    this.setData({ avatarUrl: '' })
  }
})